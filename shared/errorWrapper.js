const { putMetric, logger } = require("./cloudWatchLogger");

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

      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: err && err.message ? err.message : "Internal server error",
        }),
      };
    }
  };
}

module.exports = { wrap, registerProcessLevelHandlers };
