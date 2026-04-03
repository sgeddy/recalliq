import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { ZodSchema } from "zod";

/**
 * Validates a Fastify request body against a Zod schema.
 * Returns a typed result or throws a 400 error with validation details.
 */
export function parseBody<T>(request: FastifyRequest, schema: ZodSchema<T>): T {
  const result = schema.safeParse(request.body);

  if (!result.success) {
    const error = Object.assign(new Error("Validation error"), {
      statusCode: 400,
      validation: result.error.flatten(),
    });
    throw error;
  }

  return result.data;
}

/**
 * Validates query string parameters against a Zod schema.
 */
export function parseQuery<T>(request: FastifyRequest, schema: ZodSchema<T>): T {
  const result = schema.safeParse(request.query);

  if (!result.success) {
    const error = Object.assign(new Error("Query validation error"), {
      statusCode: 400,
      validation: result.error.flatten(),
    });
    throw error;
  }

  return result.data;
}

/**
 * Validates route params against a Zod schema.
 */
export function parseParams<T>(request: FastifyRequest, schema: ZodSchema<T>): T {
  const result = schema.safeParse(request.params);

  if (!result.success) {
    const error = Object.assign(new Error("Parameter validation error"), {
      statusCode: 400,
      validation: result.error.flatten(),
    });
    throw error;
  }

  return result.data;
}

/**
 * Plugin that sets a global error handler to format Zod and other errors
 * consistently as JSON API error responses.
 */
const zodValidatorPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.setErrorHandler((error, _request, reply) => {
    const statusCode = error.statusCode ?? 500;

    const body: Record<string, unknown> = {
      statusCode,
      error: getErrorTitle(statusCode),
      message: error.message,
    };

    // Include field-level validation details when available
    if ("validation" in error) {
      body["validation"] = error["validation"];
    }

    if (statusCode >= 500) {
      fastify.log.error(error);
    }

    void reply.status(statusCode).send(body);
  });
};

function getErrorTitle(statusCode: number): string {
  const titles: Record<number, string> = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    409: "Conflict",
    422: "Unprocessable Entity",
    429: "Too Many Requests",
    500: "Internal Server Error",
  };

  return titles[statusCode] ?? "Error";
}

export default fp(zodValidatorPlugin, {
  name: "zod-validator",
});
