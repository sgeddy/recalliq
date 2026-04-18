import type { FastifyPluginAsync } from "fastify";
import { createClerkClient } from "@clerk/fastify";
import { Webhook } from "svix";

const WEBHOOK_SECRET = process.env["CLERK_WEBHOOK_SECRET"] ?? "";

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const clerkClient = createClerkClient({ secretKey: process.env["CLERK_SECRET_KEY"]! });

// Allowed email addresses that can sign up. Checked on user.created webhook.
// Comma-separated in env: "alice@example.com,bob@example.com"
function getAllowedEmails(): Set<string> {
  const raw = process.env["ALLOWED_SIGNUP_EMAILS"] ?? "";
  if (!raw) return new Set();
  return new Set(raw.split(",").map((e) => e.trim().toLowerCase()));
}

interface ClerkUserEvent {
  type: string;
  data: {
    id: string;
    email_addresses?: Array<{
      email_address: string;
    }>;
  };
}

export const clerkWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /webhooks/clerk — Clerk sends events here
  fastify.post(
    "/webhooks/clerk",
    {
      config: {
        rateLimit: { max: 50, timeWindow: "1 minute" },
      },
    },
    async (request, reply) => {
      if (!WEBHOOK_SECRET) {
        fastify.log.error("CLERK_WEBHOOK_SECRET is not configured");
        return reply.status(500).send({ error: "Webhook not configured" });
      }

      // Verify the Svix signature
      const svixId = request.headers["svix-id"] as string | undefined;
      const svixTimestamp = request.headers["svix-timestamp"] as string | undefined;
      const svixSignature = request.headers["svix-signature"] as string | undefined;

      if (!svixId || !svixTimestamp || !svixSignature) {
        return reply.status(400).send({ error: "Missing svix headers" });
      }

      const wh = new Webhook(WEBHOOK_SECRET);
      let event: ClerkUserEvent;

      try {
        event = wh.verify(JSON.stringify(request.body), {
          "svix-id": svixId,
          "svix-timestamp": svixTimestamp,
          "svix-signature": svixSignature,
        }) as ClerkUserEvent;
      } catch (err) {
        fastify.log.warn({ err }, "Clerk webhook signature verification failed");
        return reply.status(400).send({ error: "Invalid signature" });
      }

      // Handle user.created — enforce signup allowlist
      if (event.type === "user.created") {
        const userId = event.data.id;
        const emails = event.data.email_addresses?.map((e) => e.email_address.toLowerCase()) ?? [];
        const allowed = getAllowedEmails();

        // If no allowlist is configured, allow all signups (open mode)
        if (allowed.size === 0) {
          fastify.log.info({ userId, emails }, "No signup allowlist configured — allowing signup");
          return reply.status(200).send({ received: true });
        }

        const isAllowed = emails.some((email) => allowed.has(email));

        if (!isAllowed) {
          fastify.log.warn({ userId, emails }, "Unauthorized signup — banning user");
          try {
            await clerkClient.users.banUser(userId);
          } catch (err) {
            fastify.log.error({ err, userId }, "Failed to ban unauthorized user");
          }
          return reply.status(200).send({ received: true, action: "banned" });
        }

        fastify.log.info({ userId, emails }, "Authorized signup — user allowed");
      }

      return reply.status(200).send({ received: true });
    },
  );
};
