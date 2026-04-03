import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/health", async (_request, reply) => {
    await reply.status(200).send({
      status: "ok",
      timestamp: new Date().toISOString(),
      version: process.env["npm_package_version"] ?? "0.0.1",
    });
  });
};
