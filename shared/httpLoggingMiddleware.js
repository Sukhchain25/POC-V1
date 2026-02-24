const { logger, setRequestId, setCorrelationId } = require("./cloudWatchLogger");
const { v4: uuidv4 } = require("uuid");

/**
 * HTTP Logging Middleware for Fastify
 * Tracks request/response lifecycle with performance metrics
 */
async function httpLoggingMiddleware(request, reply) {
  const startTime = Date.now();
  const requestId = request.id || uuidv4();
  const correlationId = request.headers["x-correlation-id"] || uuidv4();
  
  // Set context for this request
  setRequestId(requestId);
  setCorrelationId(correlationId);
  
  // Store on request object for route handlers
  request.requestId = requestId;
  request.correlationId = correlationId;
  request.startTime = startTime;

  // Log incoming request
  logger.info("HTTP Request", {
    method: request.method,
    url: request.url,
    path: request.url.split("?")[0],
    correlationId,
    requestId,
    userAgent: request.headers["user-agent"],
    ip: request.ip,
    queryParams: request.query && Object.keys(request.query).length > 0 ? request.query : undefined,
  });

  // Hook to log response
  reply.addHook("onResponse", (reply, done) => {
    const duration = Date.now() - startTime;
    const statusCode = reply.statusCode;
    const isError = statusCode >= 400;
    const logLevel = isError ? "error" : "info";

    logger[logLevel]("HTTP Response", {
      method: request.method,
      url: request.url,
      statusCode,
      duration,
      correlationId,
      requestId,
      ...(isError && { errorDetails: reply.payload?.error || "Unknown error" }),
    });

    done();
  });
}

/**
 * Error Logging Hook for Fastify
 * Captures and logs errors with full context
 */
async function errorLoggingHook(request, reply, error) {
  const duration = Date.now() - request.startTime;
  
  logger.error("Request Error", {
    method: request.method,
    url: request.url,
    statusCode: reply.statusCode,
    error: error.message,
    errorStack: error.stack,
    duration,
    correlationId: request.correlationId,
    requestId: request.requestId,
  });
}

module.exports = {
  httpLoggingMiddleware,
  errorLoggingHook,
};
