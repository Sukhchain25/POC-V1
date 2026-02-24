const axios = require("axios");

const { v4: uuidv4 } = require("uuid");
const {
  putMetric,
  logger,
  setCorrelationId,
} = require("../shared/cloudWatchLogger");

const MOCK_BACKEND_URL = "http://localhost:4000";
const TOKEN_LAMBDA_URL = "http://localhost:3000/dev/token";

module.exports.handler = async (event) => {
  // Only Payment Lambda generates UUID if not present
  const correlationId = event.headers?.["x-correlation-id"] || uuidv4();
  setCorrelationId(correlationId);

  logger.info("Payment Lambda triggered", {
    requestId: event.requestContext?.requestId,
  });
  const startTime = Date.now();

  try {
    const body = JSON.parse(event.body);
    const { encryption, paymentData } = body;

    if (!paymentData) {
      logger.warn("Payment Lambda: paymentData is required");
      await putMetric("PaymentValidationError", 1, "Count", [
        { Name: "ErrorType", Value: "MissingPaymentData" },
      ]);
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "paymentData is required" }),
      };
    }

    let finalResponse;

    if (encryption === true) {
      logger.info("Payment Lambda: Encryption enabled, calling Token Lambda");

      // Token Lambda ko call karo — woh JOSE encrypt karega aur mock backend pe bhejega
      try {
        const tokenResponse = await axios.post(
          TOKEN_LAMBDA_URL,
          {
            paymentData,
          },
          {
            headers: {
              "x-correlation-id": correlationId,
            },
          },
        );
        finalResponse = tokenResponse.data;
        logger.info("Payment Lambda: Token Lambda call successful");
        await putMetric("TokenLambdaCallSuccess", 1, "Count");
      } catch (error) {
        logger.error("Payment Lambda: Token Lambda call failed", {
          error: error.message,
        });
        await putMetric("TokenLambdaCallError", 1, "Count", [
          { Name: "ErrorType", Value: "TokenLambdaFailed" },
        ]);
        throw error;
      }
    } else {
      logger.info(
        "Payment Lambda: Encryption disabled, calling Mock Backend directly",
      );

      // Directly mock backend pe jao (no encryption, no token)
      try {
        const response = await axios.post(
          `${MOCK_BACKEND_URL}/resources/payment`,
          paymentData,
          {
            headers: {
              "Content-Type": "application/json",
              "x-source": "payment-lambda-no-encryption",
              "x-correlation-id": correlationId,
            },
          },
        );
        finalResponse = response.data;
        logger.info("Payment Lambda: Mock Backend call successful");
        await putMetric("MockBackendCallSuccess", 1, "Count");
      } catch (error) {
        logger.error("Payment Lambda: Mock Backend call failed", {
          error: error.message,
        });
        await putMetric("MockBackendCallError", 1, "Count", [
          { Name: "ErrorType", Value: "MockBackendFailed" },
        ]);
        throw error;
      }
    }

    const duration = Date.now() - startTime;
    logger.info("Payment Lambda: Success", { duration });
    await putMetric("PaymentSuccess", 1, "Count");
    await putMetric("PaymentDuration", duration, "Milliseconds");

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        encryption,
        result: finalResponse,
      }),
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("Payment Lambda error", {
      error: err.message,
      duration,
    });
    await putMetric("PaymentError", 1, "Count", [
      { Name: "ErrorType", Value: err.message.split(":")[0] },
    ]);
    await putMetric("PaymentDuration", duration, "Milliseconds");

    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};

// Wraping handler with centralized error wrapper to catch unexpected errors
const { wrap } = require("../shared/errorWrapper");
module.exports.handler = wrap(module.exports.handler);
