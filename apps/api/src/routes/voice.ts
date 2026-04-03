/**
 * Voice routes — Twilio Conversation Relay + ElevenLabs TTS + Claude AI
 *
 * Flow:
 *   1. Worker calls client.calls.create({ url: GET /twiml/review-call })
 *   2. Twilio fetches TwiML from GET /twiml/review-call?enrollmentId=xxx
 *   3. TwiML returns <ConversationRelay url="wss://.../ws/review"> with ElevenLabs as TTS
 *   4. Twilio opens a WebSocket to /ws/review
 *   5. WS handler receives `setup`, loads due cards, starts the review session with Claude
 *   6. Claude streams text tokens back → Twilio synthesizes via ElevenLabs → plays to caller
 *   7. Caller's speech is transcribed by Deepgram → arrives as `prompt` → fed back to Claude
 *   8. Session ends with `end` message → Twilio fires action callback
 *   9. Twilio Conversational Intelligence processes the call transcript post-session
 */

import Anthropic from "@anthropic-ai/sdk";
import type { FastifyPluginAsync } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import twilio from "twilio";

import {
  cards,
  courses,
  db,
  enrollments,
  eq,
  modules,
  reviewEvents,
  users,
  and,
  lte,
  isNull,
} from "@recalliq/db";

import { buildRequireAuth } from "../plugins/clerk-auth.js";

// ---------------------------------------------------------------------------
// Env-driven config
// ---------------------------------------------------------------------------

const TWILIO_ACCOUNT_SID = process.env["TWILIO_ACCOUNT_SID"] ?? "";
const TWILIO_AUTH_TOKEN = process.env["TWILIO_AUTH_TOKEN"] ?? "";
const TWILIO_PHONE_NUMBER = process.env["TWILIO_PHONE_NUMBER"] ?? "";
const TWILIO_INTELLIGENCE_SERVICE_SID = process.env["TWILIO_INTELLIGENCE_SERVICE_SID"] ?? "";
const ELEVENLABS_VOICE_ID = process.env["ELEVENLABS_VOICE_ID"] ?? "21m00Tcm4TlvDq8ikWAM";
// Full public URL of this API server (needed for TwiML callback URLs)
const API_BASE_URL = process.env["API_BASE_URL"] ?? "http://localhost:3001";
const WS_BASE_URL = process.env["WS_BASE_URL"] ?? API_BASE_URL.replace(/^http/, "ws");

const MAX_CARDS_PER_CALL = 10;

// ---------------------------------------------------------------------------
// In-memory session state — keyed by Twilio call SID
// Cleaned up when the WS closes. OK for single-process; use Redis for multi-instance.
// ---------------------------------------------------------------------------

interface CardItem {
  id: string;
  type: string;
  front: string;
  back: string;
  options: string[] | null;
  correctOptionIndex: number | null;
  moduleName: string;
}

interface VoiceSession {
  callSid: string;
  enrollmentId: string;
  userName: string;
  courseTitle: string;
  cards: CardItem[];
  currentIndex: number;
  correctCount: number;
  history: Anthropic.Messages.MessageParam[];
}

const activeSessions = new Map<string, VoiceSession>();

// ---------------------------------------------------------------------------
// Anthropic client
// ---------------------------------------------------------------------------

const anthropic = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });

function buildSystemPrompt(session: VoiceSession): string {
  return `You are RecallIQ, an encouraging voice-based study assistant for ${session.userName}. You are conducting a spaced-repetition review session for the course "${session.courseTitle}".

You have ${session.cards.length} question${session.cards.length !== 1 ? "s" : ""} to review in this call. You will go through them one at a time.

Rules:
- Keep responses SHORT and conversational — this is a phone call, not a lecture.
- For MCQ questions, read the question then list the options as: "A... B... C... D..."
- After the caller answers, confirm if correct and give a one-sentence explanation.
- For flashcard/free recall, read the front of the card, wait for their answer, then confirm.
- If they get it wrong, briefly explain the correct answer and move on warmly.
- Track progress internally. After the last card, give a brief summary: how many correct out of total, and an encouraging closing line.
- Never say "as an AI" or break character. You are a study coach.
- Do not mention card IDs, module names, or internal system details.
- Speak naturally — use contractions, short sentences, active voice.

Current card (index ${session.currentIndex + 1} of ${session.cards.length}):
Type: ${session.cards[session.currentIndex]?.type ?? "unknown"}
Question: ${session.cards[session.currentIndex]?.front ?? "(none)"}
${session.cards[session.currentIndex]?.options ? `Options:\nA. ${session.cards[session.currentIndex]!.options![0]}\nB. ${session.cards[session.currentIndex]!.options![1]}\nC. ${session.cards[session.currentIndex]!.options![2]}\nD. ${session.cards[session.currentIndex]!.options![3]}` : ""}
Correct answer: ${session.cards[session.currentIndex]?.back ?? ""}`;
}

// ---------------------------------------------------------------------------
// Stream LLM reply back to Twilio as text tokens
// ---------------------------------------------------------------------------

async function streamReply(
  ws: WebSocket,
  session: VoiceSession,
  userMessage: string,
): Promise<string> {
  session.history.push({ role: "user", content: userMessage });

  let fullReply = "";

  const stream = await anthropic.messages.stream({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: buildSystemPrompt(session),
    messages: session.history,
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      const token = event.delta.text;
      fullReply += token;
      ws.send(JSON.stringify({ type: "text", token, last: false }));
    }
  }

  // Mark end of turn
  ws.send(JSON.stringify({ type: "text", token: "", last: true }));

  session.history.push({ role: "assistant", content: fullReply });
  return fullReply;
}

// ---------------------------------------------------------------------------
// Load due cards for this enrollment
// ---------------------------------------------------------------------------

async function loadDueCards(enrollmentId: string): Promise<CardItem[]> {
  const now = new Date();

  const rows = await db
    .select({
      id: cards.id,
      type: cards.type,
      front: cards.front,
      back: cards.back,
      options: cards.options,
      correctOptionIndex: cards.correctOptionIndex,
      moduleName: modules.title,
    })
    .from(reviewEvents)
    .innerJoin(cards, eq(cards.id, reviewEvents.cardId))
    .innerJoin(modules, eq(modules.id, cards.moduleId))
    .where(
      and(
        eq(reviewEvents.enrollmentId, enrollmentId),
        lte(reviewEvents.scheduledAt, now),
        isNull(reviewEvents.completedAt),
      ),
    )
    .limit(MAX_CARDS_PER_CALL);

  return rows;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export const voiceRoutes: FastifyPluginAsync = async (fastify) => {
  const requireAuth = buildRequireAuth();

  // -------------------------------------------------------------------------
  // GET /twiml/review-call
  // Called by Twilio when an outbound call connects. Returns ConversationRelay TwiML.
  // -------------------------------------------------------------------------
  fastify.get("/twiml/review-call", async (request, reply) => {
    // Validate Twilio signature
    const signature = (request.headers["x-twilio-signature"] as string) ?? "";
    const url = `${API_BASE_URL}/twiml/review-call`;
    const params = request.query as Record<string, string>;
    const isValid = twilio.validateRequest(TWILIO_AUTH_TOKEN, signature, url, params);

    if (!isValid && process.env["NODE_ENV"] === "production") {
      return reply.code(403).send("Forbidden");
    }

    const enrollmentId = (request.query as Record<string, string>)["enrollmentId"] ?? "";

    const intelligenceAttr = TWILIO_INTELLIGENCE_SERVICE_SID
      ? `intelligenceService="${TWILIO_INTELLIGENCE_SERVICE_SID}"`
      : "";

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="${WS_BASE_URL}/ws/review"
      ttsProvider="ElevenLabs"
      voice="${ELEVENLABS_VOICE_ID}"
      transcriptionProvider="deepgram"
      speechModel="nova-2"
      interruptible="any"
      welcomeGreeting="Hi! I'm your RecallIQ study assistant. Give me just a moment to load your review session."
      ${intelligenceAttr}
    >
      <Parameter name="enrollmentId" value="${enrollmentId}" />
    </ConversationRelay>
  </Connect>
</Response>`;

    reply.header("Content-Type", "text/xml; charset=utf-8");
    return twiml;
  });

  // -------------------------------------------------------------------------
  // POST /webhooks/call-status
  // Twilio fires this when a call's status changes (completed, failed, etc.)
  // Used to clean up any session state that wasn't cleared via WS close.
  // -------------------------------------------------------------------------
  fastify.post("/webhooks/call-status", async (request, reply) => {
    const body = request.body as Record<string, string>;
    const callSid = body["CallSid"] ?? "";
    const callStatus = body["CallStatus"] ?? "";

    fastify.log.info({ callSid, callStatus }, "call status update");
    activeSessions.delete(callSid);
    return reply.code(204).send();
  });

  // -------------------------------------------------------------------------
  // GET /enrollments/:enrollmentId/voice-call  (protected)
  // Initiates an outbound call immediately. Workers use the BullMQ queue for
  // scheduled calls; this endpoint is for on-demand / manual triggers from UI.
  // -------------------------------------------------------------------------
  fastify.post(
    "/enrollments/:enrollmentId/voice-call",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId;
      if (!userId) return reply.code(401).send({ error: "Unauthorized" });

      const { enrollmentId } = request.params as { enrollmentId: string };

      // Ownership check
      const [enrollment] = await db
        .select()
        .from(enrollments)
        .where(and(eq(enrollments.id, enrollmentId), eq(enrollments.userId, userId)))
        .limit(1);

      if (!enrollment) return reply.code(404).send({ error: "Enrollment not found" });

      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user?.phone) {
        return reply
          .code(400)
          .send({ error: "No phone number on file. Please add one in settings." });
      }

      const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

      const call = await client.calls.create({
        to: user.phone,
        from: TWILIO_PHONE_NUMBER,
        url: `${API_BASE_URL}/twiml/review-call?enrollmentId=${enrollmentId}`,
        statusCallback: `${API_BASE_URL}/webhooks/call-status`,
        statusCallbackMethod: "POST",
        statusCallbackEvent: ["completed", "failed", "no-answer"],
      });

      return reply.code(202).send({ callSid: call.sid, status: call.status });
    },
  );

  // -------------------------------------------------------------------------
  // WebSocket /ws/review — ConversationRelay handler
  // -------------------------------------------------------------------------
  fastify.get("/ws/review", { websocket: true }, (socket: WebSocket, _request) => {
    let session: VoiceSession | null = null;

    socket.on("message", async (raw: Buffer | string) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        fastify.log.warn("WS: invalid JSON frame");
        return;
      }

      const type = msg["type"] as string;

      switch (type) {
        // ------------------------------------------------------------------
        case "setup": {
          const callSid = msg["callSid"] as string;
          const customParams = (msg["customParameters"] ?? {}) as Record<string, string>;
          const enrollmentId = customParams["enrollmentId"] ?? "";

          fastify.log.info({ callSid, enrollmentId }, "WS: setup");

          // Load enrollment + user + course
          const [enrollment] = await db
            .select()
            .from(enrollments)
            .where(eq(enrollments.id, enrollmentId))
            .limit(1);

          if (!enrollment) {
            socket.send(
              JSON.stringify({
                type: "end",
                handoffData: JSON.stringify({ error: "enrollment_not_found" }),
              }),
            );
            return;
          }

          const [user] = await db
            .select()
            .from(users)
            .where(eq(users.id, enrollment.userId))
            .limit(1);

          const [course] = await db
            .select({ title: courses.title })
            .from(courses)
            .where(eq(courses.id, enrollment.courseId))
            .limit(1);

          const dueCards = await loadDueCards(enrollmentId);

          session = {
            callSid,
            enrollmentId,
            userName: user?.name ?? "there",
            courseTitle: course?.title ?? "your course",
            cards: dueCards,
            currentIndex: 0,
            correctCount: 0,
            history: [],
          };

          activeSessions.set(callSid, session);

          if (dueCards.length === 0) {
            await streamReply(
              socket,
              session,
              "system: No cards are due right now. Greet the user and let them know they're all caught up, then end the session.",
            );
            socket.send(
              JSON.stringify({
                type: "end",
                handoffData: JSON.stringify({ reason: "no_cards_due" }),
              }),
            );
            return;
          }

          // Greet and ask the first question
          await streamReply(
            socket,
            session,
            `system: Greet ${session.userName} warmly and introduce the first review question.`,
          );
          break;
        }

        // ------------------------------------------------------------------
        case "prompt": {
          if (!session) return;

          const voicePrompt = (msg["voicePrompt"] as string) ?? "";
          fastify.log.info({ voicePrompt, cardIndex: session.currentIndex }, "WS: prompt");

          const reply = await streamReply(socket, session, voicePrompt);

          // Determine if the assistant indicated we should move to the next card.
          // Heuristic: Claude says something like "correct" / "that's right" or "next"
          // and we're on the same card. A more robust approach would be structured output.
          const lowerReply = reply.toLowerCase();
          const isAdvancing =
            lowerReply.includes("next question") ||
            lowerReply.includes("let's move on") ||
            lowerReply.includes("moving on") ||
            lowerReply.includes("here's question") ||
            lowerReply.includes("question number");

          // Track correct answers (rough heuristic from reply text)
          if (
            lowerReply.includes("correct") ||
            lowerReply.includes("that's right") ||
            lowerReply.includes("exactly right") ||
            lowerReply.includes("well done") ||
            lowerReply.includes("nice work")
          ) {
            session.correctCount += 1;
          }

          if (isAdvancing) {
            session.currentIndex = Math.min(session.currentIndex + 1, session.cards.length - 1);
          }

          // Detect session end signal from Claude (says "session is complete" / "that's all")
          const isComplete =
            lowerReply.includes("session is complete") ||
            lowerReply.includes("that's all your questions") ||
            lowerReply.includes("all done for today") ||
            lowerReply.includes("good luck with your studies");

          if (isComplete || session.currentIndex >= session.cards.length) {
            socket.send(
              JSON.stringify({
                type: "end",
                handoffData: JSON.stringify({
                  enrollmentId: session.enrollmentId,
                  cardsReviewed: session.cards.length,
                  correctCount: session.correctCount,
                }),
              }),
            );
          }
          break;
        }

        // ------------------------------------------------------------------
        case "interrupt": {
          if (!session) return;
          // Patch history: replace last assistant turn with what was actually heard
          const heard = (msg["utteranceUntilInterrupt"] as string) ?? "";
          fastify.log.info({ heard }, "WS: interrupt");
          if (session.history.length > 0) {
            const last = session.history[session.history.length - 1];
            if (last?.role === "assistant") {
              last.content = heard + " [interrupted]";
            }
          }
          break;
        }

        // ------------------------------------------------------------------
        case "dtmf": {
          if (!session) return;
          const digit = (msg["digit"] as string) ?? "";
          fastify.log.info({ digit }, "WS: dtmf");
          // Treat DTMF as if the user said the corresponding option letter
          const dtmfToOption: Record<string, string> = {
            "1": "A",
            "2": "B",
            "3": "C",
            "4": "D",
            "0": "end session",
          };
          const spokenOption = dtmfToOption[digit] ?? digit;
          await streamReply(
            socket,
            session,
            `User pressed ${digit} — treat as answer: ${spokenOption}`,
          );
          break;
        }

        // ------------------------------------------------------------------
        case "error": {
          fastify.log.error({ msg }, "WS: conversation relay error");
          break;
        }

        default:
          fastify.log.debug({ type }, "WS: unknown message type");
      }
    });

    socket.on("close", () => {
      if (session) {
        fastify.log.info({ callSid: session.callSid }, "WS: session closed");
        activeSessions.delete(session.callSid);
        session = null;
      }
    });

    socket.on("error", (err: Error) => {
      fastify.log.error({ err }, "WS: socket error");
      if (session) activeSessions.delete(session.callSid);
    });
  });
};
