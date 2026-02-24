// ─────────────────────────────────────────
// Auth Routes — /oauth/token
// Client credentials grant type
// ─────────────────────────────────────────

const { logger } = require("../../shared/cloudWatchLogger");

async function authRoutes(fastify, options) {
  // Schema for request validation (Fastify built-in)
  const tokenSchema = {
    body: {
      type: "object",
      required: ["client_id", "client_secret"],
      properties: {
        client_id: { type: "string" },
        client_secret: { type: "string" },
        grant_type: { type: "string" },
      },
    },
  };

  // POST /oauth/token
  fastify.post("/token", { schema: tokenSchema }, async (request, reply) => {
    const { client_id, client_secret, grant_type } = request.body;

    fastify.log.info(`Auth request received — client_id: ${client_id}`);
    logger.info("OAuth token endpoint called", { client_id });

    // ─── Credentials validate karo ───
    if (client_id !== "poc-client" || client_secret !== "poc-secret") {
      logger.warn("Invalid OAuth credentials", { client_id });
      return reply.status(401).send({
        error: "invalid_client",
        error_description: "Invalid client credentials",
      });
    }

    // ─── JWT Access Token banao ───
    const accessToken = fastify.jwt.sign(
      {
        client_id,
        scope: "payment:write payment:read",
        grant_type: grant_type || "client_credentials",
      },
      { expiresIn: "1h" },
    );

    fastify.log.info(`Access token generated for client: ${client_id}`);
    logger.info("OAuth token generated successfully", {
      client_id,
    });

    return reply.status(200).send({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      scope: "payment:write payment:read",
    });
  });
}

module.exports = authRoutes;
