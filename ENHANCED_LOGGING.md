# Enhanced Logging Documentation

## Overview

The logging system has been enhanced to provide comprehensive tracking across your POC payment system. It includes:

- **Correlation ID Tracking** - Track requests across distributed services
- **Request ID Tracking** - Unique ID for each HTTP request
- **Structured Logging** - Consistent metadata injection
- **HTTP Middleware Logging** - Automatic request/response tracking
- **Error Tracking** - Full stack traces and error context
- **Performance Metrics** - Automatic duration tracking
- **CloudWatch Integration** - Production-ready cloud logging

## Components

### 1. Core Logger (`shared/cloudWatchLogger.js`)

Enhanced with additional context capabilities:

```javascript
const { 
  logger, 
  setCorrelationId, 
  getCorrelationId,
  setRequestId,
  getRequestId,
  setUserId,
  getUserId,
  logWithContext,
  putMetric
} = require("../shared/cloudWatchLogger");

// Set context for a request
setCorrelationId("uuid-123");
setRequestId("req-456");
setUserId("user-789");

// Log with automatic context injection
logger.info("Payment processed", {
  amount: 100,
  currency: "USD"
  // correlationId, requestId, userId are automatically added
});

// Log with full context helper
logWithContext("info", "Operation completed", {
  operation: "payment_process",
  duration: 250
});
```

### 2. HTTP Logging Middleware (`shared/httpLoggingMiddleware.js`)

Automatically logs all HTTP requests and responses with performance metrics.

**Usage in Fastify:**

```javascript
const { httpLoggingMiddleware, errorLoggingHook } = require("../shared/httpLoggingMiddleware");

// Add as pre-handler hook
fastify.addHook("preHandler", httpLoggingMiddleware);

// Add error handler
fastify.setErrorHandler(errorLoggingHook);
```

**What it logs:**
- Incoming request (method, URL, query params, IP, user agent)
- Outgoing response (status code, duration)
- Errors (with full stack trace)
- Automatically sets Request ID and Correlation ID

### 3. Structured Logger (`shared/structuredLogger.js`)

High-level logger with service-specific context.

**Usage:**

```javascript
const { createLogger } = require("../shared/structuredLogger");
const logger = createLogger("paymentService");

// All these logs automatically include service, correlationId, requestId, userId
logger.info("Payment initiated", { amount: 100, currency: "USD" });
logger.warn("Slow operation detected", { duration: 5100 });
logger.error("Payment failed", error, { retryCount: 3 });
logger.performance("encrypt_token", 1250, { algorithm: "HS256" });
logger.debug("Debugging info", { details: "..." });
```

## Context Fields

All logs automatically include:

| Field | Source | Purpose |
|-------|--------|---------|
| `correlationId` | Header `x-correlation-id` or UUID | Track request across services |
| `requestId` | Fastify `request.id` or UUID | Track individual HTTP request |
| `userId` | Set via `setUserId()` | Track user actions |
| `timestamp` | `new Date().toISOString()` | Record when event occurred |
| `service` | Structured logger | Identify which service logged it |

## Log Levels

- **info** - Normal operations (requests, successful operations)
- **warn** - Warnings (missing context, slow operations, validations)
- **error** - Errors (failures, exceptions)
- **debug** - Debugging info (only in dev)

## Example: Lambda Enhancement

**Before:**
```javascript
logger.info("Payment Lambda: Token Lambda call successful");
```

**After:**
```javascript
const { createLogger } = require("../shared/structuredLogger");
const logger = createLogger("paymentLambda");

logger.info("Token Lambda call successful", {
  duration: 250,
  tokenProvider: "mock-backend",
  encryptionEnabled: true
});
```

**Result (logged):**
```json
{
  "timestamp": "2024-02-24T10:30:45.123Z",
  "level": "info",
  "message": "Token Lambda call successful",
  "service": "paymentLambda",
  "correlationId": "uuid-123",
  "requestId": "req-456",
  "duration": 250,
  "tokenProvider": "mock-backend",
  "encryptionEnabled": true
}
```

## Configuration

Environment variables:

```bash
# Log level (info, warn, error, debug)
LOG_LEVEL=info

# CloudWatch settings
CLOUDWATCH_ENABLED=true
CLOUDWATCH_LOG_GROUP=/local/poc-payment-system
CLOUDWATCH_LOG_STREAM=stream-${Date.now()}
AWS_REGION=ap-south-1
AWS_ENVIRONMENT=local-dev

# Request correlation IDs are auto-generated if not provided
# Pass in headers: x-correlation-id: <UUID>
```

## Performance Metrics

The system automatically tracks performance for operations:

```javascript
const startTime = Date.now();
// ... do something
const duration = Date.now() - startTime;

logger.performance("process_payment", duration, {
  amount: 100,
  provider: "stripe"
});

// Warnings are logged if duration > 5000ms
```

## Error Logging

Errors include full stack traces:

```javascript
try {
  await processPayment(data);
} catch (error) {
  logger.error("Payment processing failed", error, {
    amount: 100,
    retryCount: 3
  });
}

// Logs:
// - error.message
// - error.stack (full stack trace)
// - error.code and error.statusCode (if present)
// - All provided metadata
```

## Best Practices

1. **Always include context**
   ```javascript
   // ❌ Bad
   logger.info("Done");
   
   // ✅ Good
   logger.info("Payment processed", { amount: 100, gateway: "stripe" });
   ```

2. **Use service-specific loggers**
   ```javascript
   // At top of file
   const { createLogger } = require("../shared/structuredLogger");
   const logger = createLogger("paymentService");
   ```

3. **Log operation start, end, and errors**
   ```javascript
   logger.info("Starting payment process", { orderId });
   try {
     const result = await chargeCard(data);
     logger.info("Payment successful", { txId: result.id });
   } catch (error) {
     logger.error("Payment failed", error, { orderId });
   }
   ```

4. **Use performance logging for slow operations**
   ```javascript
   const start = Date.now();
   const encrypted = await encryptPayment(data);
   logger.performance("encrypt_payment", Date.now() - start);
   ```

5. **Include relevant IDs in logs**
   ```javascript
   // ✅ Include IDs for tracking
   logger.info("Transaction created", {
     transactionId: txId,
     orderId: orderId,
     userId: userId
   });
   ```

## Integration Examples

### Mock Backend Route Handler

```javascript
const { createLogger } = require("../../shared/structuredLogger");
const logger = createLogger("authRoute");

fastify.post("/oauth/token", async (request, reply) => {
  logger.info("OAuth token requested", {
    clientId: request.body.client_id,
    grantType: request.body.grant_type
  });

  try {
    const token = await generateToken(request.body);
    logger.info("Token generated successfully");
    return { access_token: token };
  } catch (error) {
    logger.error("Token generation failed", error);
    throw error;
  }
});
```

### Lambda Handler

```javascript
const { createLogger } = require("../shared/structuredLogger");
const logger = createLogger("paymentLambda");

module.exports.handler = async (event) => {
  const correlationId = event.headers?.["x-correlation-id"];
  setCorrelationId(correlationId);
  
  const startTime = Date.now();
  logger.info("Payment Lambda triggered", { eventType: "payment" });

  try {
    const result = await processPayment(event.body);
    const duration = Date.now() - startTime;
    
    logger.performance("payment_process", duration, {
      amount: result.amount,
      success: true
    });
    
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (error) {
    logger.error("Payment processing failed", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
```

## Viewing Logs

### Local Console
Logs appear in console with formatted output:
```
[2024-02-24T10:30:45.123Z] [INFO] [CID: uuid-123] [RID: req-456] Payment processed {"amount": 100}
```

### CloudWatch (when enabled)
Logs are sent to CloudWatch with full JSON structure for querying and analysis.

### Log Queries (CloudWatch Insights)

```sql
# Find all errors for a correlation ID
fields @timestamp, @message, @duration
| filter correlationId = "uuid-123"
| filter @message like /error/i
| stats count() by service

# Find slow operations
fields @timestamp, @message, durationMs
| filter durationMs > 5000
| stats avg(durationMs) by service

# Payment processing flow
fields @timestamp, @message, correlationId, statusCode
| filter service in ["paymentLambda", "tokenLambda", "paymentService"]
| sort @timestamp desc
```

## Troubleshooting

**Missing correlation IDs?**
- Ensure clients pass `x-correlation-id` header
- System auto-generates if missing, but manual tracking is better

**Logs not appearing?**
- Check `LOG_LEVEL` environment variable
- Verify CloudWatch credentials if using cloud logging
- Check that service is running (check exit codes in context)

**Performance metrics not tracking?**
- Make sure to use `logger.performance()` method
- For HTTP middleware, it's automatic

## Next Steps

To fully implement enhanced logging:

1. Update `mock-backend/server.js` to use the HTTP middleware
2. Update route handlers to use `createLogger`
3. Update Lambda handlers to use structured logging
4. Configure CloudWatch with appropriate credentials for production
5. Set up CloudWatch Insights queries for dashboards
