const { logger, getCorrelationId, getRequestId, getUserId } = require("./cloudWatchLogger");

/**
 * Structured Logger - Provides consistent logging interface with automatic context injection
 */
class StructuredLogger {
  constructor(service) {
    this.service = service;
  }

  /**
   * Get base metadata that's included in all logs
   */
  getBaseMetadata() {
    return {
      service: this.service,
      correlationId: getCorrelationId(),
      requestId: getRequestId(),
      userId: getUserId(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Log info level
   */
  info(message, metadata = {}) {
    logger.info(message, {
      ...this.getBaseMetadata(),
      ...metadata,
    });
  }

  /**
   * Log warning level
   */
  warn(message, metadata = {}) {
    logger.warn(message, {
      ...this.getBaseMetadata(),
      ...metadata,
    });
  }

  /**
   * Log error level with optional error object
   */
  error(message, error = null, metadata = {}) {
    const errorMetadata = {};
    
    if (error instanceof Error) {
      errorMetadata.error = error.message;
      errorMetadata.errorStack = error.stack;
      if (error.code) errorMetadata.errorCode = error.code;
      if (error.statusCode) errorMetadata.statusCode = error.statusCode;
    } else if (error) {
      errorMetadata.error = error;
    }

    logger.error(message, {
      ...this.getBaseMetadata(),
      ...errorMetadata,
      ...metadata,
    });
  }

  /**
   * Log debug level
   */
  debug(message, metadata = {}) {
    logger.debug(message, {
      ...this.getBaseMetadata(),
      ...metadata,
    });
  }

  /**
   * Log performance metrics
   */
  performance(operationName, duration, metadata = {}) {
    const level = duration > 5000 ? "warn" : "info";
    logger[level](`Performance: ${operationName}`, {
      ...this.getBaseMetadata(),
      operation: operationName,
      durationMs: duration,
      ...metadata,
    });
  }

  /**
   * Log with custom level
   */
  log(level, message, metadata = {}) {
    logger.log(level, message, {
      ...this.getBaseMetadata(),
      ...metadata,
    });
  }
}

/**
 * Factory function to create a logger for a specific service/module
 */
function createLogger(serviceName) {
  return new StructuredLogger(serviceName);
}

module.exports = {
  createLogger,
  StructuredLogger,
};
