# CloudWatch Monitoring Implementation

## Basic Architecture Overview

This implementation integrates AWS CloudWatch across three layers:

1. **Custom Metrics** for business and operational KPIs
2. **Structured CloudWatch Logs** with automatic log group/stream management
3. **CloudWatch Dashboards & Alarms** via Infrastructure as Code

## CloudWatch Logger Module (`cloudWatchLogger.js`) — Correlation ID Support

### Features

- **Dual Output**: Logs to both console (always) and CloudWatch (when enabled)
- **Winston-powered**: Uses Winston logger with CloudWatch transport for robust log management
- **CloudWatch Gating**: All remote operations guarded by `CLOUDWATCH_ENABLED` environment variable
- **Log Level Filtering**: Respects `LOG_LEVEL` environment variable with hierarchy: ERROR > WARN > INFO > DEBUG
- **Error Resilience**: Falls back to console-only logging if CloudWatch operations fail
- **Correlation ID Tracking**: **Full distributed tracing** — every log and metric can include a unique correlation ID, automatically propagated across all services and requests.

### Exports

#### `logger` (Winston Logger Instance)

The main Winston logger instance with standard methods:

- `logger.error(message, metadata = {})` - Logs errors
- `logger.warn(message, metadata = {})` - Logs warnings
- `logger.info(message, metadata = {})` - Logs informational messages
- `logger.debug(message, metadata = {})` - Logs debug messages

**Features:**

- **Always prints to console** as JSON
- **Sends to CloudWatch Logs** if `CLOUDWATCH_ENABLED === 'true'` and level threshold met
- **Automatically includes the current correlation ID** (if set via `setCorrelationId()`) in every log entry, enabling end-to-end traceability.
- Returns silently if CloudWatch send fails; error logged locally only

#### `putMetric(metricName, value, unit = "Count", dimensions = [])`

Publishes custom metrics to CloudWatch:

- **Namespace**: `POC-Payment-System`
- **Auto-includes**: `Environment` dimension (defaults to `local-dev` if `AWS_ENVIRONMENT` not set)
- **Timestamp**: Automatically added as ISO 8601 date
- **Units**: `Count`, `Milliseconds`, etc.
- **Returns silently** if `CLOUDWATCH_ENABLED` is not `'true'`

#### `setCorrelationId(id)`

- Sets the correlation ID for the current request context (per request, not global)
- All subsequent calls to `logger.*()` and `putMetric()` will include this ID in log entries and metrics (if you add it to dimensions)
- **Should be called at the start of every request** (Lambda handler, Fastify preHandler, etc.)
- **Typical usage in Lambda entry point**:

  ```javascript
  // In your Lambda handler:
  const { logger, setCorrelationId } = require("../shared/cloudWatchLogger");

  const correlationId =
    event.headers?.["x-correlation-id"] ||
    event.requestContext?.requestId ||
    `COR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  setCorrelationId(correlationId);
  // ...rest of handler
  logger.info("Payment Lambda triggered", {
    requestId: event.requestContext?.requestId,
  });
  // When calling downstream services, always forward the correlationId:
  axios.post(url, data, { headers: { "x-correlation-id": correlationId } });
  ```

#### `getCorrelationId()`

- Retrieves the current correlation ID for the active request context
- Returns `null` if no correlation ID has been set
- Useful for propagating the ID in outbound requests (e.g., HTTP headers)

## Correlation ID Propagation: Best Practices

1. **Always extract or generate a correlation ID at the entry point** (API Gateway, Lambda, Fastify route):
   - Extract from `x-correlation-id` header if present
   - Fallback to AWS/Lambda request ID if available
   - Otherwise, generate a new one: `COR-{timestamp}-{random}`
2. **Set the correlation ID in the logger context** using `setCorrelationId()`
3. **Forward the correlation ID in all outbound HTTP requests** (as `x-correlation-id` header)
4. **Downstream services must extract and set the correlation ID** for their own context/logging
5. **All logs and metrics will now be traceable by this ID**

### Example: Lambda Handler

```javascript
const {
  setCorrelationId,
  logger,
  putMetric,
} = require("../shared/cloudWatchLogger");

exports.handler = async (event) => {
  const correlationId =
    event.headers?.["x-correlation-id"] ||
    event.requestContext?.requestId ||
    `COR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  setCorrelationId(correlationId);

  logger.info("Payment Lambda triggered", {
    requestId: event.requestContext?.requestId,
  });

  try {
    // Your business logic here
    logger.debug("Processing payment", { paymentId: "123" });
    await putMetric("PaymentSuccess", 1, "Count");
    return { statusCode: 200, body: "OK" };
  } catch (error) {
    logger.error("Payment processing failed", { error: error.message });
    await putMetric("PaymentError", 1, "Count", [
      { Name: "ErrorType", Value: error.code },
    ]);
    throw error;
  }
};
```

### Example: Fastify Global preHandler

```javascript
const { setCorrelationId, logger } = require("../shared/cloudWatchLogger");

fastify.addHook("preHandler", (request, reply, done) => {
  const correlationId =
    request.headers["x-correlation-id"] ||
    `COR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  setCorrelationId(correlationId);
  logger.debug("Request received", { path: request.url });
  done();
});
```

### Metrics Tracked

#### Success Metrics

| Metric                   | When                          | Unit  |
| ------------------------ | ----------------------------- | ----- |
| `PaymentSuccess`         | Successful payment completion | Count |
| `TokenLambdaCallSuccess` | Token service call succeeds   | Count |
| `MockBackendCallSuccess` | Direct backend call succeeds  | Count |

#### Error Metrics

| Metric                   | When                        | Unit  | Dimension                                       |
| ------------------------ | --------------------------- | ----- | ----------------------------------------------- |
| `PaymentError`           | Any payment failure         | Count | ErrorType (extracted from error message prefix) |
| `TokenLambdaCallError`   | Token service failure       | Count | ErrorType: TokenLambdaFailed                    |
| `MockBackendCallError`   | Backend API failure         | Count | ErrorType: MockBackendFailed                    |
| `PaymentValidationError` | Missing/invalid paymentData | Count | ErrorType: MissingPaymentData                   |

#### Performance Metrics

| Metric            | Description                      | Unit         |
| ----------------- | -------------------------------- | ------------ |
| `PaymentDuration` | End-to-end Lambda execution time | Milliseconds |

### Environment Variables

Control CloudWatch integration behavior:

| Variable             | Required | Default      | Purpose                                                                                                  |
| -------------------- | -------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| `CLOUDWATCH_ENABLED` | Yes      | —            | Set to `'true'` to enable remote CloudWatch Logs and metrics; if not set, logger outputs to console only |
| `LOG_LEVEL`          | No       | `INFO`       | Determines which log levels send to CloudWatch: `ERROR`, `WARN`, `INFO`, `DEBUG`                         |
| `AWS_REGION`         | No       | `ap-south-1` | AWS region for CloudWatch Logs and Metrics clients                                                       |
| `AWS_ENVIRONMENT`    | No       | `local-dev`  | Used as the `Environment` dimension in all metrics                                                       |

## Distributed Tracing with Correlation IDs

### Overview

**Correlation IDs** enable distributed tracing across the entire request flow. Every service, Lambda, and backend logs with the same correlation ID, making it easy to trace a request end-to-end in CloudWatch Logs and Metrics.

```
Payment Lambda
    ↓ (with x-correlation-id header)
Token Lambda
    ↓ (with x-correlation-id header)
Mock Backend (/oauth/token)
Mock Backend (/resources/payment)
```

All services log with the same `correlationId`, enabling you to trace a single request end-to-end in CloudWatch Logs.

### How Correlation IDs Work (End-to-End)

1. **Payment Lambda** (entry point):

- Checks for `x-correlation-id` header
- Falls back to Lambda `requestContext.requestId`
- Generates one if neither available: `COR-{timestamp}-{random}`
- Calls `setCorrelationId(correlationId)` to set context
- Passes ID in headers to Token Lambda and Mock Backend
- All logs and metrics for this request include the correlation ID

2. **Token Lambda** (downstream):

- Extracts `x-correlation-id` from incoming request headers
- Calls `setCorrelationId(correlationId)` with extracted ID
- Passes same ID forward to Mock Backend in headers
- All CloudWatch logs and metrics include this ID

3. **Mock Backend** (Fastify server):

- Global `preHandler` hook extracts `x-correlation-id` from headers
- Calls `setCorrelationId(correlationId)` for entire request
- All routes and downstream calls include the ID in logs and metrics

### Example: Tracking a Request End-to-End

1. **API Gateway** → **Payment Lambda** (generates or receives `COR-1706234567890-abc123def`)
2. **Payment Lambda** logs: `{ correlationId: "COR-1706234567890-abc123def", message: "Payment Lambda triggered" }`
3. **Payment Lambda** calls **Token Lambda** with header: `x-correlation-id: COR-1706234567890-abc123def`
4. **Token Lambda** logs: `{ correlationId: "COR-1706234567890-abc123def", message: "Token Lambda triggered" }`
5. **Token Lambda** calls **Mock Backend** with header: `x-correlation-id: COR-1706234567890-abc123def`
6. **Mock Backend** logs: `{ correlationId: "COR-1706234567890-abc123def", message: "Payment endpoint called" }`

**Query CloudWatch Logs for a request:**

```bash
# Find all logs for a specific correlation ID
fields @timestamp, level, message, correlationId
| filter correlationId = "COR-1706234567890-abc123def"
| sort @timestamp asc
```

### Correlation ID Format

- Default generated format: `COR-{timestamp}-{9-char-random-string}`
- Example: `COR-1706235890123-x7kp9l2m4`
- You can pass custom correlation IDs via the `x-correlation-id` header from external systems (Postman, etc.)

### Logging Implementation Example

```javascript
// Standard log output (always printed to console and sent to CloudWatch if enabled):
// Using logger.info(), logger.warn(), logger.error(), logger.debug()

const { logger, setCorrelationId } = require("../shared/cloudWatchLogger");

setCorrelationId("COR-1234567890-abc123def");

logger.info("Payment Lambda triggered", {
  requestId: "abc-123",
});

// Output:
{
  timestamp: "2024-01-01T00:00:00.000Z",
  level: "info",
  message: "Payment Lambda triggered",
  correlationId: "COR-1234567890-abc123def",  // Always included if set
  requestId: "abc-123"  // Included via metadata object
}
```

**Note:**

- Use `logger.info()`, `logger.warn()`, `logger.error()`, or `logger.debug()` to log messages
- `correlationId` is automatically included in all logs when set via `setCorrelationId()`
- Additional metadata is passed as the second parameter and included in the output

---

**Summary:**

- Always use `setCorrelationId()` at the start of every request
- Use `logger.info()`, `logger.warn()`, `logger.error()`, `logger.debug()` for logging
- Forward the correlation ID in all HTTP calls via `x-correlation-id` header
- All logs and metrics will be traceable by this ID in CloudWatch
