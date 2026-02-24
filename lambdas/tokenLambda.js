const axios = require("axios");
const { SignJWT, jwtVerify } = require("jose");

const { v4: uuidv4 } = require("uuid");
const {
  putMetric,
  logger,
  setCorrelationId,
} = require("../shared/cloudWatchLogger");

const MOCK_BACKEND_URL = "http://localhost:4000";

// JOSE secret key (minimum 32 characters)
const JOSE_SECRET = new TextEncoder().encode(
  "my-super-secret-jose-key-32chars!!",
);

module.exports.handler = async (event) => {
  // Extract or generate correlation ID (prefer UUID)
  // Require correlation ID from upstream, never generate a new one
  const correlationId = event.headers?.["x-correlation-id"];
  if (!correlationId) {
    logger.warn("Missing correlation ID in Token Lambda request");
  }
  setCorrelationId(correlationId);

  logger.info("Token Lambda triggered", {
    requestId: event.requestContext?.requestId,
  });
  const startTime = Date.now();

  try {
    const body = JSON.parse(event.body);
    const { paymentData } = body;
    let accessToken; // Declare accessToken for use across steps

    if (!paymentData) {
      logger.warn("Token Lambda: paymentData is required");
      await putMetric("TokenValidationError", 1, "Count", [
        { Name: "ErrorType", Value: "MissingPaymentData" },
      ]);
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "paymentData is required" }),
      };
    }

    // ─────────────────────────────────────────
    // Step 1: Mock Backend ke Auth Server se OAuth Token lo
    // ─────────────────────────────────────────
    logger.info(
      "Token Lambda: Step 1 - Fetching OAuth token from mock backend",
    );
    try {
      const tokenRes = await axios.post(
        `${MOCK_BACKEND_URL}/oauth/token`,
        {
          client_id: "poc-client",
          client_secret: "poc-secret",
          grant_type: "client_credentials",
        },
        {
          headers: {
            "x-correlation-id": correlationId,
          },
        },
      );

      accessToken = tokenRes.data.access_token;
      logger.info("Token Lambda: Step 1 - OAuth Token received", {
        token: accessToken ? "✓" : "✗",
      });
      await putMetric("OAuthTokenFetch", 1, "Count", [
        { Name: "Status", Value: "Success" },
      ]);
    } catch (error) {
      logger.error("Token Lambda: Step 1 - OAuth token fetch failed", {
        error: error.message,
      });
      await putMetric("OAuthTokenFetch", 1, "Count", [
        { Name: "Status", Value: "Failed" },
      ]);
      throw error;
    }

    // ─────────────────────────────────────────
    // Step 2: JOSE se paymentData encrypt (sign) karo
    // ─────────────────────────────────────────
    logger.info("Token Lambda: Step 2 - Signing paymentData with JOSE");
    const signedToken = await new SignJWT({ paymentData })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .setIssuer("token-lambda")
      .setAudience("mock-backend")
      .sign(JOSE_SECRET);

    logger.info("Token Lambda: Step 2 - JOSE signed token created ✓");
    await putMetric("JOSESigningSuccess", 1, "Count");

    // ─────────────────────────────────────────
    // Step 3: Encrypted payload ko Mock Backend pe bhejo
    // ─────────────────────────────────────────
    logger.info(
      "Token Lambda: Step 3 - Sending encrypted payload to mock backend",
    );
    try {
      const response = await axios.post(
        `${MOCK_BACKEND_URL}/resources/payment`,
        { encryptedPayload: signedToken },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            "x-correlation-id": correlationId,
          },
        },
      );

      logger.info("Token Lambda: Step 3 - Mock backend response received ✓");
      await putMetric("MockBackendCallSuccess", 1, "Count");

      const duration = Date.now() - startTime;
      logger.info("Token Lambda: Success", { duration });
      await putMetric("TokenLambdaSuccess", 1, "Count");
      await putMetric("TokenLambdaDuration", duration, "Milliseconds");

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          success: true,
          message: "Payment processed with JOSE encryption",
          result: response.data,
        }),
      };
    } catch (error) {
      logger.error("Token Lambda: Step 3 - Mock backend call failed", {
        error: error.message,
      });
      await putMetric("MockBackendCallError", 1, "Count", [
        { Name: "ErrorType", Value: "MockBackendFailed" },
      ]);
      throw error;
    }
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Token Lambda error", {
      error: err.message,
      duration,
    });
    await putMetric("TokenLambdaError", 1, "Count", [
      { Name: "ErrorType", Value: err.message.split(":")[0] },
    ]);
    await putMetric("TokenLambdaDuration", duration, "Milliseconds");

    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};

// Wrap handler with centralized error wrapper to catch unexpected errors
const { wrap } = require("../shared/errorWrapper");
module.exports.handler = wrap(module.exports.handler);
