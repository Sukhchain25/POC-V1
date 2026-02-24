const { putMetric, logger } = require("./cloudWatchLogger");
const { FISErrorType, AppError } = require("./errorTypes");
const { ERROR_CODES } = require("./errorCodes");

/**
 * Generate standardized FIS error response
 */
function fisErrorResponse(statusCode, title, type, details, instance) {
  const response = {
    type,
    title,
    status: statusCode,
    details,
    instance,
  };

  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(response),
  };
}

/**
 * Comprehensive error handler following FIS standards
 */
function handleError(error, context = {}, instance = "/api/v1/payment") {
  const apiInstance = instance || "/api/v1/payment";
  const requestId = context.awsRequestId || context.requestId;

  // Log error details
  try {
    logger.error("Error occurred in Lambda", {
      name: error.name,
      message: error.message,
      stack: error.stack,
      requestId,
      functionName: context.functionName,
      errorCode: error.code,
    });
  } catch (logErr) {
    console.error("Error logging exception:", logErr);
  }

  // ═══════════════════════════════════════════
  // 1. Validation Errors (HTTP 400)
  // Missing or invalid request fields
  // ═══════════════════════════════════════════
  if (error.isValidationError || error.statusCode === 400) {
    const errorCode = error.errorCode || ERROR_CODES.MISSING_BODY;
    const details = [
      {
        code: errorCode,
        message: error.message,
        field: error.field,
      },
    ];

    return fisErrorResponse(
      400,
      "API - PositivePayIssues - Validation failed",
      FISErrorType.API_VALIDATION,
      details,
      apiInstance,
    );
  }

  // ═══════════════════════════════════════════
  // 2. System Validation Error (HTTP 422)
  // Business logic failures
  // ═══════════════════════════════════════════
  if (error instanceof AppError && error.statusCode === 422) {
    const details = [
      {
        code: error.errorCode || ERROR_CODES.ELIGIBILITY_FAILED,
        message: error.message,
      },
    ];

    return fisErrorResponse(
      422,
      "API - PositivePayIssues - Host validation failed",
      FISErrorType.SYSTEM_VALIDATION,
      details,
      `${apiInstance}/downstream`,
    );
  }

  // ═══════════════════════════════════════════
  // 3. Technical Error (HTTP 503)
  // Network connectivity issues
  // ═══════════════════════════════════════════
  if (
    error.code === "ECONNREFUSED" ||
    error.code === "ENOTFOUND" ||
    error.code === "ETIMEDOUT"
  ) {
    const details = [
      {
        code: ERROR_CODES.SERVICE_UNAVAILABLE,
        message: "Failed to connect to backend service",
      },
    ];

    return fisErrorResponse(
      503,
      "API - PositivePayIssues - Downstream service unavailable",
      FISErrorType.TECHNICAL,
      details,
      `${apiInstance}/downstream`,
    );
  }

  // External API errors (Axios)
  if (error.response && error.response.status >= 500) {
    const details = [
      {
        code: ERROR_CODES.SERVICE_UNAVAILABLE,
        message: error.response.data?.message || "External service unavailable",
      },
    ];

    return fisErrorResponse(
      503,
      "API - PositivePayIssues - Downstream service unavailable",
      FISErrorType.TECHNICAL,
      details,
      `${apiInstance}/downstream`,
    );
  }

  // ═══════════════════════════════════════════
  // 4. Authentication Error (HTTP 401)
  // Token/Auth failures
  // ═══════════════════════════════════════════
  if (
    error.name === "JsonWebTokenError" ||
    error.name === "TokenExpiredError" ||
    error.code === "ERR_JWT_EXPIRED" ||
    error.code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" ||
    (error instanceof AppError && error.statusCode === 401)
  ) {
    const details = [
      {
        code:
          error.name === "TokenExpiredError"
            ? ERROR_CODES.TOKEN_EXPIRED
            : ERROR_CODES.UNAUTHORIZED,
        message:
          error.name === "TokenExpiredError"
            ? "Token expired"
            : "Invalid or missing authentication token",
      },
    ];

    return fisErrorResponse(
      401,
      "API - PositivePayIssues - Authentication failed",
      FISErrorType.AUTHENTICATION,
      details,
      apiInstance,
    );
  }

  // ═══════════════════════════════════════════
  // 5. Custom AppErrors from request handlers
  // ═══════════════════════════════════════════
  if (error instanceof AppError) {
    const details = [
      {
        code: error.errorCode || "APP-ERROR",
        message: error.message,
      },
    ];

    const errorType =
      error.statusCode === 400
        ? FISErrorType.API_VALIDATION
        : error.statusCode === 422
          ? FISErrorType.SYSTEM_VALIDATION
          : FISErrorType.TECHNICAL;

    return fisErrorResponse(
      error.statusCode,
      `API - PositivePayIssues - ${error.errorCode || "Error"}`,
      errorType,
      details,
      apiInstance,
    );
  }

  // ═══════════════════════════════════════════
  // 6. Unknown Internal Errors (HTTP 500)
  // ═══════════════════════════════════════════
  const details = [
    {
      code: ERROR_CODES.INTERNAL_ERROR,
      message:
        process.env.NODE_ENV === "development"
          ? error.message || "Internal server error"
          : "An unexpected error occurred",
    },
  ];

  return fisErrorResponse(
    500,
    "API - PositivePayIssues - Internal server error",
    "urn:doneplatform:doneb:error:internal",
    details,
    apiInstance,
  );
}

function registerProcessLevelHandlers() {
  if (global.__errorHandlersRegistered) return;
  global.__errorHandlersRegistered = true;

  process.on("unhandledRejection", (reason) => {
    try {
      const msg = reason && reason.message ? reason.message : String(reason);
      logger.error("unhandledRejection", { error: msg });
      putMetric("UnhandledRejection", 1, "Count").catch(() => {});
    } catch (e) {
      console.error("Error reporting unhandledRejection:", e);
    }
  });

  process.on("uncaughtException", (err) => {
    try {
      logger.error("uncaughtException", { error: err.message });
      putMetric("UncaughtException", 1, "Count").catch(() => {});
    } catch (e) {
      console.error("Error reporting uncaughtException:", e);
    }
    // for long-running processes we exit; in lambda this won't be reached often
    try {
      // give logging a moment then exit
      setTimeout(() => process.exit(1), 1000);
    } catch (e) {
      // noop
    }
  });
}

function wrap(handler) {
  registerProcessLevelHandlers();

  return async (event, context) => {
    try {
      return await handler(event, context);
    } catch (err) {
      try {
        logger.error("Lambda handler uncaught error", {
          error: err && err.message ? err.message : String(err),
        });
        await putMetric("LambdaHandlerError", 1, "Count");
      } catch (e) {
        console.error("Error reporting lambda handler error:", e);
      }

      // Use the standardized FIS error handler
      return handleError(err, context);
    }
  };
}

module.exports = {
  wrap,
  registerProcessLevelHandlers,
  handleError,
  fisErrorResponse,
  AppError,
};
