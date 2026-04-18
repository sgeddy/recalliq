import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { parseBody } from "../plugins/zod-validator.js";

const registerBodySchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255),
});

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /auth/register — stub
  // TODO(team): Wire up Clerk webhook to sync user creation to the DB (#15)
  // User creation is handled by Clerk; this endpoint is a placeholder for
  // any post-registration logic (e.g. creating a Stripe customer).
  fastify.post(
    "/auth/register",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      parseBody(request, registerBodySchema);

      await reply.status(201).send({
        message: "Registration is handled via Clerk. This endpoint is a stub.",
      });
    },
  );
};
