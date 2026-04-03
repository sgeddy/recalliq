import cors from "@fastify/cors";
import websocketPlugin from "@fastify/websocket";
import Fastify from "fastify";

import { extractUserId } from "./plugins/clerk-auth.js";
import zodValidatorPlugin from "./plugins/zod-validator.js";
import { authRoutes } from "./routes/auth.js";
import { courseRoutes } from "./routes/courses.js";
import { enrollmentRoutes } from "./routes/enrollments.js";
import { healthRoutes } from "./routes/health.js";
import { mockExamRoutes } from "./routes/mock-exams.js";
import { reviewRoutes } from "./routes/reviews.js";
import { voiceRoutes } from "./routes/voice.js";

const PORT = parseInt(process.env["API_PORT"] ?? "3001", 10);
const HOST = process.env["API_HOST"] ?? "0.0.0.0";
const IS_PRODUCTION = process.env["NODE_ENV"] === "production";

async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: IS_PRODUCTION ? "info" : "debug",
      ...(IS_PRODUCTION
        ? {}
        : {
            transport: {
              target: "pino-pretty",
              options: { colorize: true },
            },
          }),
    },
  });

  // WebSocket support — register before routes
  await fastify.register(websocketPlugin);

  // CORS — before auth so OPTIONS preflight is handled first
  await fastify.register(cors, {
    origin: IS_PRODUCTION ? (process.env["ALLOWED_ORIGINS"]?.split(",") ?? []) : true,
    credentials: true,
  });

  // Global error handler + Zod validation helpers
  await fastify.register(zodValidatorPlugin);

  // Attach verified Clerk userId to every request
  fastify.decorateRequest("userId", null);
  fastify.addHook("onRequest", async (request) => {
    request.userId = await extractUserId(request);
  });

  // Routes
  await fastify.register(healthRoutes);
  await fastify.register(authRoutes);
  await fastify.register(courseRoutes);
  await fastify.register(enrollmentRoutes);
  await fastify.register(mockExamRoutes);
  await fastify.register(reviewRoutes);
  await fastify.register(voiceRoutes);

  return fastify;
}

async function start(): Promise<void> {
  const server = await buildServer();

  try {
    await server.listen({ port: PORT, host: HOST });
    server.log.info(`Server listening on ${HOST}:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

void start();

export { buildServer };
