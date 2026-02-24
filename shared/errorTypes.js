/**
 * FIS Error Types - Standardized error URNs
 */
const FISErrorType = {
  API_VALIDATION: "urn:doneplatform:doneb:error:api-validation",
  SYSTEM_VALIDATION: "urn:doneplatform:doneb:error:system-validation",
  TECHNICAL: "urn:doneplatform:doneb:error:technical",
  AUTHENTICATION: "urn:doneplatform:doneb:error:authentication",
};

/**
 * FIS Error Detail - Individual error detail object
 * @typedef {Object} FISErrorDetail
 * @property {string} code - Error code (e.g., 'DONEB-01001')
 * @property {string} message - Error message
 * @property {string} [field] - Optional field name for validation errors
 */

/**
 * FIS Error Response - Standardized error response format
 * @typedef {Object} FISErrorResponse
 * @property {string} type - Error type URN
 * @property {string} title - Error title
 * @property {number} status - HTTP status code
 * @property {FISErrorDetail[]} details - Array of error details
 * @property {string} instance - Request instance/endpoint
 */

/**
 * Custom Application Error Class
 */
class AppError extends Error {
  constructor(
    message,
    statusCode = 500,
    errorCode = undefined,
    isOperational = true,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = isOperational;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = {
  FISErrorType,
  AppError,
};
