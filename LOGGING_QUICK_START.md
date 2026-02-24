# Enhanced Logging - Quick Implementation Guide

## What's New

✨ **New Logging Features Added:**

1. **`httpLoggingMiddleware.js`** - Auto-logs all HTTP requests/responses with timing
2. **`structuredLogger.js`** - Service-specific logger with context injection  
3. **Enhanced `cloudWatchLogger.js`** - Better context tracking (requestId, userId)
4. **HTTP Error Logging** - Comprehensive error tracking with stack traces

## How to Use

### Option 1: Use in Fastify Routes (Already integrated in server.js)

```javascript
// mock-backend/routes/auth.js
const { createLogger } = require("../../shared/structuredLogger");
const logger = createLogger("authService");

fastify.post("/oauth/token", async (request, reply) => {
  // correlationId, requestId automatically in context from middleware
  
  logger.info("OAuth token request received", {
    clientId: request.body.client_id,
    grantType: request.body.grant_type
  });

  try {
    const token = await generateToken(request.body);
    logger.info("Token generated", { tokenLength: token.length });
    return { access_token: token };
  } catch (error) {
    logger.error("Token generation failed", error, { 
      clientId: request.body.client_id 
    });
    throw error;
  }
});
```

### Option 2: Use in Lambda Functions

```javascript
// lambdas/paymentLambda.js
const { 
  logger, 
  setCorrelationId, 
  putMetric 
} = require("../shared/cloudWatchLogger");
const { createLogger } = require("../shared/structuredLogger");

// Create service-specific logger
const serviceLogger = createLogger("paymentLambda");

module.exports.handler = async (event) => {
  const correlationId = event.headers?.["x-correlation-id"] || uuidv4();
  setCorrelationId(correlationId);
  
  const startTime = Date.now();

  try {
    const { paymentData } = JSON.parse(event.body);
    
    serviceLogger.info("Processing payment", { 
      amount: paymentData.amount,
      currency: paymentData.currency 
    });

    const result = await processPayment(paymentData);
    
    const duration = Date.now() - startTime;
    serviceLogger.performance("payment_process", duration, {
      success: true,
      amount: paymentData.amount
    });
    
    await putMetric("PaymentSuccess", 1);
    return { statusCode: 200, body: JSON.stringify(result) };

  } catch (error) {
    const duration = Date.now() - startTime;
    serviceLogger.error("Payment failed", error, {
      duration,
      retryable: error.statusCode === 503
    });
    
    await putMetric("PaymentError", 1, "Count", [
      { Name: "ErrorType", Value: error.code || "Unknown" }
    ]);
    
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
```

### Option 3: Use in Regular Actions/Utilities

```javascript
// shared/authHelper.js or any utility
const { createLogger } = require("./structuredLogger");
const logger = createLogger("authHelper");

async function validateToken(token) {
  logger.info("Validating token");
  
  try {
    const payload = jwt.verify(token, SECRET);
    logger.info("Token validated", { userId: payload.userId });
    return payload;
  } catch (error) {
    logger.error("Token validation failed", error);
    throw error;
  }
}
```

## Available Logger Methods

```javascript
const { createLogger } = require("../shared/structuredLogger");
const logger = createLogger("serviceName");

// Basic logging (automatic context injection)
logger.info("message", { customField: "value" });
logger.warn("message", { customField: "value" });
logger.error("message", errorObject, { customField: "value" });
logger.debug("message", { customField: "value" });

// Performance tracking
logger.performance("operationName", durationInMs, { extras: "optional" });

// Direct logger access (less structured)
const { logger: rawLogger } = require("../shared/cloudWatchLogger");
rawLogger.info("message", { data: "value" });
```

## Context That's Automatically Logged

Every log call includes:
- ✅ `service` - Service name (e.g., "paymentLambda")
- ✅ `correlationId` - Tracks request across services
- ✅ `requestId` - Unique HTTP request ID
- ✅ `userId` - User performing action (if set)
- ✅ `timestamp` - ISO timestamp
- ➕ Your custom metadata

```javascript
// This log:
logger.info("Payment processed", { amount: 100 });

// Becomes:
{
  timestamp: "2024-02-24T10:30:45.123Z",
  level: "info",
  message: "Payment processed",
  service: "paymentLambda",
  correlationId: "550e8400-e29b-41d4-a716-446655440000",
  requestId: "req-12345",
  userId: "user-789",
  amount: 100
}
```

## Setting Additional Context

```javascript
const { 
  setCorrelationId, 
  setRequestId, 
  setUserId 
} = require("../shared/cloudWatchLogger");

// In Lambda
const correlationId = event.headers["x-correlation-id"] || uuidv4();
setCorrelationId(correlationId);

// In route handler (automatic with middleware)
setUserId(request.user.id);

// All subsequent logs include this context
```

## Examples by Use Case

### Example 1: Payment Processing Flow

```javascript
const { createLogger } = require("../shared/structuredLogger");
const logger = createLogger("paymentProcessor");

async function processPayment(paymentData, userId) {
  const startTime = Date.now();
  
  logger.info("Payment processing started", {
    userId,
    amount: paymentData.amount,
    provider: paymentData.gateway
  });

  try {
    // Step 1: Validate
    logger.debug("Validating payment data");
    validatePayment(paymentData);
    logger.info("Payment validation passed");

    // Step 2: Process
    logger.info("Calling payment gateway", { gateway: paymentData.gateway });
    const chargeResult = await chargeCard(paymentData);
    logger.info("Payment charged successfully", { txId: chargeResult.id });

    // Step 3: Record transaction
    await saveTransaction(chargeResult, userId);
    
    const duration = Date.now() - startTime;
    logger.performance("payment_complete", duration, {
      txId: chargeResult.id,
      amount: paymentData.amount
    });

    return chargeResult;

  } catch (error) {
    const duration = Date.now() - startTime;
    
    if (error.code === "GATEWAY_TIMEOUT") {
      logger.warn("Payment gateway timeout (retryable)", {
        duration,
        attempts: 3
      });
    } else {
      logger.error("Payment processing failed", error, {
        userId,
        amount: paymentData.amount,
        duration
      });
    }
    
    throw error;
  }
}
```

### Example 2: API Middleware

```javascript
// Already integrated, but here's what it does:

fastify.addHook("preHandler", httpLoggingMiddleware);
// Logs:
// - HTTP request (method, path, params, IP)
// - Request ID and Correlation ID
// - Request duration and response status
```

### Example 3: Error Handling

```javascript
const { createLogger } = require("../shared/structuredLogger");
const logger = createLogger("errorHandler");

try {
  const result = await riskyOperation();
} catch (error) {
  // Error is automatically logged with:
  // - error.message
  // - error.stack (full stack trace)
  // - error.statusCode (if present)
  logger.error("Operation failed", error, {
    operation: "riskyOperation",
    retries: 3
  });
  
  throw error;
}
```

## Migration Checklist

If updating existing code:

- [ ] Add `const { createLogger } = require("../shared/structuredLogger")` at top of file
- [ ] Change `logger = createLogger("serviceName")`
- [ ] Replace `logger.info("msg")` with `logger.info("msg", { field: value })`
- [ ] Replace error logging with `logger.error("msg", error, { context })`
- [ ] For performance tracking, use `logger.performance("op", duration)`
- [ ] Remove manual `setCorrelationId()` calls (middleware does it)

## Testing Locally

When you run the mock backend:

```bash
cd mock-backend
npm start
```

Logs appear in console with formatting:
```
[2024-02-24T10:30:45.123Z] [INFO] [CID: 550e8400-e29b] [RID: req-12345] Payment processed {"amount": 100}
[2024-02-24T10:30:47.456Z] [ERROR] [CID: 550e8400-e29b] [RID: req-12345] Payment failed {"error": "Network timeout"}
```

## CloudWatch Configuration

When deploying to AWS:

```bash
export CLOUDWATCH_ENABLED=true
export AWS_REGION=ap-south-1
export CLOUDWATCH_LOG_GROUP=/prod/poc-payment-system
export CLOUDWATCH_LOG_STREAM=payment-lambda-prod
```

Logs automatically sync to CloudWatch for historical search and monitoring.

## Troubleshooting

**Q: Correlation ID not propagating?**
A: Ensure clients send `x-correlation-id` header, or Lambda explicitly sets it with `setCorrelationId()`

**Q: Logs not showing in Lambda?**
A: Verify Lambda has CloudWatch Logs permissions in IAM

**Q: Performance logs showing wrong duration?**
A: Use `logger.performance()` instead of manually calculating, or ensure timing is in milliseconds

## Questions?

Refer to [ENHANCED_LOGGING.md](./ENHANCED_LOGGING.md) for complete documentation.
