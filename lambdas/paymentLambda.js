const axios = require("axios");

const { v4: uuidv4 } = require("uuid");
const {
  putMetric,
  logger,
  logError,
  logInfo,
  logWarn,
  setCorrelationId,
} = require("../shared/cloudWatchLogger");
const { handleError, AppError } = require("../shared/errorWrapper");
const { ERROR_CODES } = require("../shared/errorCodes");

const MOCK_BACKEND_URL = "http://localhost:4000";
const TOKEN_LAMBDA_URL = "http://localhost:3000/dev/token";

module.exports.handler = async (event, context) => {
  // Only Payment Lambda generates UUID if not present
  const correlationId = event.headers?.["x-correlation-id"] || uuidv4();
  setCorrelationId(correlationId);

  logInfo("Payment Lambda triggered", {
    requestId: event.requestContext?.requestId,
  });
  const startTime = Date.now();

  try {
    if (!event.body) {
      throw new AppError(
        "Request body is required",
        400,
        ERROR_CODES.MISSING_BODY,
      );
    }

    const body = JSON.parse(event.body);
    const { encryption, paymentData } = body;

    if (!paymentData) {
      logWarn("Payment Lambda: paymentData is required", {
        errorCode: ERROR_CODES.MISSING_BODY,
      });
      throw new AppError(
        "paymentData is required",
        400,
        ERROR_CODES.MISSING_BODY,
      );
    }

    let finalResponse;

    if (encryption === true) {
      logInfo("Payment Lambda: Encryption enabled, calling Token Lambda");

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
        logInfo("Payment Lambda: Token Lambda call successful");
        await putMetric("TokenLambdaCallSuccess", 1, "Count");
      } catch (error) {
        logError(
          "Payment Lambda: Token Lambda call failed",
          ERROR_CODES.SERVICE_UNAVAILABLE,
          {
            errorMessage: error.message,
          },
        );
        await putMetric("TokenLambdaCallError", 1, "Count", [
          { Name: "ErrorType", Value: "TokenLambdaFailed" },
        ]);
        throw error;
      }
    } else {
      logInfo(
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
        logInfo("Payment Lambda: Mock Backend call successful");
        await putMetric("MockBackendCallSuccess", 1, "Count");
      } catch (error) {
        logError(
          "Payment Lambda: Mock Backend call failed",
          ERROR_CODES.SERVICE_UNAVAILABLE,
          {
            errorMessage: error.message,
          },
        );
        await putMetric("MockBackendCallError", 1, "Count", [
          { Name: "ErrorType", Value: "MockBackendFailed" },
        ]);
        throw error;
      }
    }

    const duration = Date.now() - startTime;
    logInfo("Payment Lambda: Success", { duration });
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
    logError(
      "Payment Lambda error",
      err.errorCode || ERROR_CODES.INTERNAL_ERROR,
      {
        errorMessage: err.message,
        duration,
      },
    );
    await putMetric("PaymentError", 1, "Count", [
      { Name: "ErrorType", Value: err.message.split(":")[0] },
    ]);
    await putMetric("PaymentDuration", duration, "Milliseconds");

    // Use standardized error handler
    return handleError(err, event.requestContext || event, "/api/v1/payment");
  }
};

// Wraping handler with centralized error wrapper to catch unexpected errors
const { wrap } = require("../shared/errorWrapper");
module.exports.handler = wrap(module.exports.handler);
