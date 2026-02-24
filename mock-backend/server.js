const fastify = require("fastify")({
  logger: {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    },
  },
});

// Import shared error handling
const { registerProcessLevelHandlers } = require("../shared/errorWrapper");
const { logger, setCorrelationId } = require("../shared/cloudWatchLogger");

// Register process-level error handlers (unhandledRejection, uncaughtException)
registerProcessLevelHandlers();

// ─────────────────────────────────────────
// Correlation ID Hook
// ─────────────────────────────────────────

fastify.addHook("preHandler", async (request, reply) => {
  const correlationId = request.headers["x-correlation-id"];
  if (!correlationId) {
    logger.warn("Missing correlation ID in Mock Backend request");
  }
  setCorrelationId(correlationId);
  // Store on request for access in routes
  request.correlationId = correlationId;
});

// ─────────────────────────────────────────
// JWT Plugin Register karo
// ─────────────────────────────────────────
fastify.register(require("@fastify/jwt"), {
  secret: "mock-backend-jwt-secret-key-2024",
});

// ─────────────────────────────────────────
// Routes Register karo
// ─────────────────────────────────────────
fastify.register(require("./routes/auth"), { prefix: "/oauth" });
fastify.register(require("./routes/resources"), { prefix: "/resources" });

// ─────────────────────────────────────────
// Fastify global error handler
// ─────────────────────────────────────────
fastify.setErrorHandler(function (error, request, reply) {
  logger.error("Fastify error", {
    error: error && error.message ? error.message : String(error),
  });
  fastify.log.error(error);
  // respond with generic message to avoid leaking internals
  reply.status(500).send({ error: "Internal Server Error" });
});
// ─────────────────────────────────────────
// Health Check
// ─────────────────────────────────────────
fastify.get("/health", async (request, reply) => {
  logger.info("Health check endpoint called");
  return {
    status: "ok",
    server: "Mock Backend (Fastify)",
    timestamp: new Date().toISOString(),
    port: 4000,
  };
});

// ─────────────────────────────────────────
// Server Start
// ─────────────────────────────────────────
const start = async () => {
  try {
    await fastify.listen({ port: 4000, host: "0.0.0.0" });
    logger.info("Mock Backend (Fastify) started", {
      url: "http://localhost:4000",
      health: "http://localhost:4000/health",
      routes: ["POST /oauth/token", "POST /resources/payment"],
    });
    console.log("\n========================================");
    console.log("  Mock Backend (Fastify) started!");
    console.log("  URL: http://localhost:4000");
    console.log("  Health: http://localhost:4000/health");
    console.log("  Auth:   POST /oauth/token");
    console.log("  Pay:    POST /resources/payment");
    console.log("========================================\n");
  } catch (err) {
    logger.error("Mock Backend startup error", {
      error: err.message,
    });
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
