// NOTE: Resend adapter. All calls go through BullMQ worker — never from apps/api request handlers.

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export interface SendEmailResult {
  id: string;
}

/**
 * Sends a transactional email via Resend.
 *
 * Credentials are read from environment variables (RESEND_API_KEY, RESEND_FROM_EMAIL).
 * Never pass credentials as function arguments.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const apiKey = process.env["RESEND_API_KEY"];

  if (!apiKey) {
    throw new Error("RESEND_API_KEY environment variable is not set");
  }

  const from = params.from ?? process.env["RESEND_FROM_EMAIL"] ?? "noreply@recalliq.com";

  // Dynamic import avoids loading the Resend SDK in environments where it is
  // not installed (e.g. during unit tests that mock this module).
  const { Resend } = await import("resend");
  const client = new Resend(apiKey);

  const response = await client.emails.send({
    from,
    to: params.to,
    subject: params.subject,
    html: params.html,
  });

  if (response.error) {
    throw new Error(`Resend error: ${response.error.message}`);
  }

  if (!response.data) {
    throw new Error("Resend returned no data");
  }

  return { id: response.data.id };
}

// ---------------------------------------------------------------------------
// Quiz email renderer
// ---------------------------------------------------------------------------

export interface QuizEmailParams {
  recipientName?: string;
  courseTitle: string;
  questionText: string;
  questionType: "mcq" | "flashcard";
  /** For MCQ: the answer option strings, in order (A, B, C, D, …) */
  options?: string[];
  /** The review_event id — used as the review token in links */
  reviewToken: string;
  /** Base URL of the web app, e.g. http://localhost:3000 */
  baseUrl: string;
  /** True for the first session (intervalIndex 0) — changes copy to learning/study framing */
  isInitialSession?: boolean;
}

// NOTE: Inline styles are used throughout so the email renders correctly in
// clients that strip <style> blocks (Gmail, Outlook, etc.).
const BRAND_COLOR = "#4f46e5";
const LETTER_LABELS = ["A", "B", "C", "D", "E", "F"];

/**
 * Renders a self-contained HTML email for a spaced-repetition quiz card.
 *
 * MCQ cards show answer buttons that deep-link to the review page with a
 * pre-filled answer index. Flashcard cards show a single "Reveal Answer"
 * button.
 */
export function renderQuizEmail(params: QuizEmailParams): string {
  const greeting = params.recipientName ? `Hi ${escapeHtml(params.recipientName)},` : "Hi there,";
  const isInitial = params.isInitialSession ?? false;

  const reviewUrl = `${params.baseUrl}/review/${encodeURIComponent(params.reviewToken)}`;

  const questionBlock = `
    <p style="font-size:18px;font-weight:600;color:#111827;line-height:1.5;margin:0 0 24px 0;">
      ${escapeHtml(params.questionText)}
    </p>
  `;

  let answerBlock: string;

  if (params.questionType === "mcq" && params.options && params.options.length > 0) {
    const buttons = params.options
      .map((option, index) => {
        const label = LETTER_LABELS[index] ?? String(index + 1);
        const href = `${reviewUrl}?answer=${index}`;
        return `
          <a href="${escapeAttr(href)}"
             style="display:block;width:100%;box-sizing:border-box;padding:12px 16px;
                    margin-bottom:10px;background:#f9fafb;border:1px solid #e5e7eb;
                    border-radius:8px;text-decoration:none;color:#111827;font-size:15px;
                    text-align:left;">
            <span style="display:inline-block;width:24px;height:24px;line-height:24px;
                         text-align:center;border-radius:50%;background:${BRAND_COLOR};
                         color:#fff;font-weight:700;font-size:12px;margin-right:10px;
                         vertical-align:middle;">${escapeHtml(label)}</span>
            ${escapeHtml(option)}
          </a>
        `;
      })
      .join("");

    answerBlock = `<div style="margin:0 0 24px 0;">${buttons}</div>`;
  } else {
    // Flashcard — single reveal button
    answerBlock = `
      <div style="margin:0 0 24px 0;text-align:center;">
        <a href="${escapeAttr(reviewUrl)}"
           style="display:inline-block;padding:14px 32px;background:${BRAND_COLOR};
                  color:#fff;font-size:15px;font-weight:600;border-radius:8px;
                  text-decoration:none;">
          Reveal Answer
        </a>
      </div>
    `;
  }

  const headerSubtitle = isInitial ? "Your first lesson is ready" : "Spaced repetition review";
  const bodyIntro = isInitial
    ? "Your learning journey starts now. Study the card below — your first review arrives tomorrow:"
    : "It&rsquo;s time for your spaced-repetition review. Answer the question below:";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${isInitial ? "Welcome to" : "Time to review —"} ${escapeHtml(params.courseTitle)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,
             'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0"
               style="background:#fff;border-radius:12px;overflow:hidden;
                      box-shadow:0 1px 3px rgba(0,0,0,.08);">

          <!-- Header -->
          <tr>
            <td style="background:${BRAND_COLOR};padding:24px 32px;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#fff;letter-spacing:-.3px;">
                RecallIQ
              </p>
              <p style="margin:4px 0 0 0;font-size:13px;color:#c7d2fe;">
                ${escapeHtml(params.courseTitle)} &mdash; ${escapeHtml(headerSubtitle)}
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 32px 8px 32px;">
              <p style="margin:0 0 20px 0;font-size:15px;color:#374151;">${greeting}</p>
              <p style="margin:0 0 20px 0;font-size:15px;color:#374151;">
                ${bodyIntro}
              </p>

              ${questionBlock}
              ${answerBlock}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px 32px 32px;border-top:1px solid #f3f4f6;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
                You received this email because you are enrolled in
                <strong>${escapeHtml(params.courseTitle)}</strong> on RecallIQ.
                <a href="${escapeAttr(params.baseUrl)}" style="color:${BRAND_COLOR};text-decoration:none;">
                  Manage notifications
                </a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Session email renderer — summary + single CTA link to the in-app quiz
// ---------------------------------------------------------------------------

export interface SessionEmailParams {
  recipientName?: string;
  courseTitle: string;
  enrollmentId: string;
  cardCount: number;
  baseUrl: string;
  isInitialSession?: boolean;
}

export function renderSessionEmail(params: SessionEmailParams): string {
  const greeting = params.recipientName ? `Hi ${escapeHtml(params.recipientName)},` : "Hi there,";
  const isInitial = params.isInitialSession ?? false;
  const { cardCount, courseTitle, enrollmentId, baseUrl } = params;
  const estimatedMinutes = Math.ceil(cardCount * 1.5);
  const sessionUrl = `${baseUrl}/session/${encodeURIComponent(enrollmentId)}`;
  const headerSubtitle = isInitial ? "Your first lesson is ready" : "Review session ready";
  const ctaText = isInitial ? "Start Learning" : "Start Review";
  const bodyText = isInitial
    ? `Your learning journey starts now! Your first session for <strong>${escapeHtml(courseTitle)}</strong> is ready &mdash; ${cardCount} card${cardCount !== 1 ? "s" : ""}, about ${estimatedMinutes} minute${estimatedMinutes !== 1 ? "s" : ""}.`
    : `Time for your spaced repetition review. You have ${cardCount} card${cardCount !== 1 ? "s" : ""} due for <strong>${escapeHtml(courseTitle)}</strong>. Estimated time: ${estimatedMinutes} minute${estimatedMinutes !== 1 ? "s" : ""}.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(ctaText)} — ${escapeHtml(courseTitle)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">
<tr><td style="background:${BRAND_COLOR};padding:24px 32px;">
<p style="margin:0;font-size:22px;font-weight:700;color:#fff;letter-spacing:-.3px;">RecallIQ</p>
<p style="margin:4px 0 0 0;font-size:13px;color:#c7d2fe;">${escapeHtml(courseTitle)} &mdash; ${escapeHtml(headerSubtitle)}</p>
</td></tr>
<tr><td style="padding:40px 32px;">
<p style="margin:0 0 16px 0;font-size:15px;color:#374151;">${greeting}</p>
<p style="margin:0 0 32px 0;font-size:15px;color:#374151;line-height:1.6;">${bodyText}</p>
<div style="text-align:center;">
<a href="${escapeAttr(sessionUrl)}" style="display:inline-block;padding:16px 40px;background:${BRAND_COLOR};color:#fff;font-size:16px;font-weight:600;border-radius:8px;text-decoration:none;">${escapeHtml(ctaText)}</a>
</div>
</td></tr>
<tr><td style="padding:16px 32px 32px 32px;border-top:1px solid #f3f4f6;">
<p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">You received this email because you are enrolled in <strong>${escapeHtml(courseTitle)}</strong> on RecallIQ. <a href="${escapeAttr(baseUrl)}" style="color:${BRAND_COLOR};text-decoration:none;">Manage notifications</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Exam follow-up email — sent the day after the scheduled exam date
// ---------------------------------------------------------------------------

export interface ExamFollowUpEmailParams {
  recipientName?: string;
  courseTitle: string;
  enrollmentId: string;
  baseUrl: string;
}

export function renderExamFollowUpEmail(params: ExamFollowUpEmailParams): string {
  const { recipientName, courseTitle, enrollmentId, baseUrl } = params;
  const greeting = recipientName ? `Hi ${escapeHtml(recipientName)},` : "Hi there,";
  const resultUrl = `${baseUrl}/enrollments/${encodeURIComponent(enrollmentId)}/exam-result`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>How did your exam go?</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">
<tr><td style="background:${BRAND_COLOR};padding:24px 32px;">
<p style="margin:0;font-size:22px;font-weight:700;color:#fff;letter-spacing:-.3px;">RecallIQ</p>
<p style="margin:4px 0 0 0;font-size:13px;color:#c7d2fe;">${escapeHtml(courseTitle)} &mdash; Exam Day Follow-Up</p>
</td></tr>
<tr><td style="padding:40px 32px;">
<p style="margin:0 0 16px 0;font-size:15px;color:#374151;">${greeting}</p>
<p style="margin:0 0 24px 0;font-size:15px;color:#374151;line-height:1.6;">
  Yesterday was your scheduled exam day for <strong>${escapeHtml(courseTitle)}</strong>. How did it go?
</p>
<p style="margin:0 0 32px 0;font-size:15px;color:#374151;line-height:1.6;">
  Record your result so RecallIQ can set up the right next steps — whether that&rsquo;s your post-exam
  maintenance program or a fresh study plan for a retake.
</p>
<div style="text-align:center;">
<a href="${escapeAttr(resultUrl)}" style="display:inline-block;padding:16px 40px;background:${BRAND_COLOR};color:#fff;font-size:16px;font-weight:600;border-radius:8px;text-decoration:none;">Record My Result</a>
</div>
</td></tr>
<tr><td style="padding:16px 32px 32px 32px;border-top:1px solid #f3f4f6;">
<p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">You received this because your exam was scheduled via RecallIQ. <a href="${escapeAttr(baseUrl)}" style="color:${BRAND_COLOR};text-decoration:none;">Manage notifications</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Maintenance reminder email — sent at 1 month / 3 months / 6 months / 1 year
// ---------------------------------------------------------------------------

export interface MaintenanceReminderEmailParams {
  recipientName?: string;
  courseTitle: string;
  enrollmentId: string;
  intervalLabel: string; // e.g. "1 month", "3 months"
  questionCount: number;
  sessionMinutes: number;
  baseUrl: string;
}

export function renderMaintenanceReminderEmail(params: MaintenanceReminderEmailParams): string {
  const {
    recipientName,
    courseTitle,
    enrollmentId,
    intervalLabel,
    questionCount,
    sessionMinutes,
    baseUrl,
  } = params;
  const greeting = recipientName ? `Hi ${escapeHtml(recipientName)},` : "Hi there,";
  const sessionUrl = `${baseUrl}/session/${encodeURIComponent(enrollmentId)}`;
  const estimatedMinutes = sessionMinutes;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(intervalLabel)} maintenance check-in</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">
<tr><td style="background:#0d9488;padding:24px 32px;">
<p style="margin:0;font-size:22px;font-weight:700;color:#fff;letter-spacing:-.3px;">RecallIQ</p>
<p style="margin:4px 0 0 0;font-size:13px;color:#99f6e4;">${escapeHtml(courseTitle)} &mdash; ${escapeHtml(intervalLabel)} maintenance check-in</p>
</td></tr>
<tr><td style="padding:40px 32px;">
<p style="margin:0 0 16px 0;font-size:15px;color:#374151;">${greeting}</p>
<p style="margin:0 0 24px 0;font-size:15px;color:#374151;line-height:1.6;">
  It&rsquo;s been <strong>${escapeHtml(intervalLabel)}</strong> since you passed your
  <strong>${escapeHtml(courseTitle)}</strong> exam. Time for your scheduled recall check-in.
</p>
<p style="margin:0 0 32px 0;font-size:15px;color:#374151;line-height:1.6;">
  ${questionCount} questions &mdash; about ${estimatedMinutes} minutes.
  If you can recall these confidently, your long-term retention is on track.
</p>
<div style="text-align:center;">
<a href="${escapeAttr(sessionUrl)}" style="display:inline-block;padding:16px 40px;background:#0d9488;color:#fff;font-size:16px;font-weight:600;border-radius:8px;text-decoration:none;">Start ${escapeHtml(estimatedMinutes.toString())}-Minute Check-In</a>
</div>
</td></tr>
<tr><td style="padding:16px 32px 32px 32px;border-top:1px solid #f3f4f6;">
<p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">Part of your RecallIQ post-exam maintenance program for <strong>${escapeHtml(courseTitle)}</strong>. <a href="${escapeAttr(baseUrl)}" style="color:#0d9488;text-decoration:none;">Manage notifications</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, "&quot;");
}
