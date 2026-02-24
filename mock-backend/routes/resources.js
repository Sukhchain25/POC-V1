const { jwtVerify } = require("jose");
const { logger } = require("../../shared/cloudWatchLogger");

// JOSE secret — same jo tokenLambda.js mein use kiya
const JOSE_SECRET = new TextEncoder().encode(
  "my-super-secret-jose-key-32chars!!",
);

// ─────────────────────────────────────────
// Resource Routes — /resources/payment
// JWT auth middleware + Payment processing
// ─────────────────────────────────────────

async function resourceRoutes(fastify, options) {
  // ─── Auth Middleware (Bearer token verify) ───
  fastify.addHook("preHandler", async (request, reply) => {
    try {
      await request.jwtVerify();
      fastify.log.info(`Authenticated client: ${request.user.client_id}`);
    } catch (err) {
      fastify.log.warn("Unauthorized request — invalid or missing token");
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Valid Bearer token required",
      });
    }
  });

  // ─── POST /resources/payment ───
  fastify.post("/payment", async (request, reply) => {
    const body = request.body;

    fastify.log.info("Payment request received at mock backend");
    logger.info("Payment endpoint called", {
      source: request.headers["x-source"] || "encrypted-flow",
    });

    // ─── Check karo — encrypted payload hai ya plain data ───
    if (body.encryptedPayload) {
      // JOSE encrypted payload — verify & decode karo
      fastify.log.info("Encrypted payload detected — verifying JOSE token...");
      logger.info("Encrypted payload detected — verifying JOSE token");

      try {
        const { payload } = await jwtVerify(
          body.encryptedPayload,
          JOSE_SECRET,
          {
            issuer: "token-lambda",
            audience: "mock-backend",
          },
        );

        fastify.log.info("JOSE token verified successfully ✓");
        logger.info("JOSE token verified successfully");
        const paymentData = payload.paymentData;

        // ─── Payment process karo ───
        const result = processPayment(paymentData, true);
        return reply.status(200).send(result);
      } catch (err) {
        fastify.log.error(`JOSE verification failed: ${err.message}`);
        logger.error("JOSE verification failed", {
          error: err.message,
        });
        return reply.status(400).send({
          error: "Invalid encrypted payload",
          message: err.message,
        });
      }
    } else {
      // Plain data — encryption false tha
      fastify.log.info("Plain payload detected — no encryption");
      logger.info("Plain payload detected — no encryption");
      const result = processPayment(body, false);
      return reply.status(200).send(result);
    }
  });
}

// ─────────────────────────────────────────
// Payment Processing Logic
// ─────────────────────────────────────────
function processPayment(paymentData, wasEncrypted) {
  const transactionId = `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  return {
    success: true,
    transactionId,
    status: "PROCESSED",
    encrypted: wasEncrypted,
    paymentData,
    processedAt: new Date().toISOString(),
    mockBackend: true,
  };
}

module.exports = resourceRoutes;
