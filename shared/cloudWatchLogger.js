const winston = require("winston");
require("winston-cloudwatch");

const AWS_REGION = process.env.AWS_REGION || "ap-south-1";
const LOG_GROUP_NAME =
  process.env.CLOUDWATCH_LOG_GROUP || "/local/poc-payment-system";
const LOG_STREAM_NAME =
  process.env.CLOUDWATCH_LOG_STREAM || `stream-${Date.now()}`;

let currentCorrelationId = null;
let currentRequestId = null;
let currentUserId = null;

const setCorrelationId = (id) => {
  currentCorrelationId = id;
};

const getCorrelationId = () => currentCorrelationId;

const setRequestId = (id) => {
  currentRequestId = id;
};

const getRequestId = () => currentRequestId;

const setUserId = (id) => {
  currentUserId = id;
};

const getUserId = () => currentUserId;

// Custom format to inject correlationId and other context
const contextFormat = winston.format((info) => {
  info.correlationId = currentCorrelationId;
  if (currentRequestId) info.requestId = currentRequestId;
  if (currentUserId) info.userId = currentUserId;
  info.timestamp = new Date().toISOString();
  
  // Capture stack trace for errors
  if (info instanceof Error) {
    info.stack = info.stack;
  } else if (info.error instanceof Error) {
    info.errorStack = info.error.stack;
  }
  
  return info;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(contextFormat(), winston.format.json()),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        contextFormat(),
        winston.format.printf(({ timestamp, level, message, correlationId, requestId, ...meta }) => {
          const context = [
            `[${timestamp}]`,
            `[${level.toUpperCase()}]`,
          ];
          if (correlationId) context.push(`[CID: ${correlationId}]`);
          if (requestId) context.push(`[RID: ${requestId}]`);
          
          const metaStr = Object.keys(meta).length > 0 
            ? ` ${JSON.stringify(meta)}` 
            : "";
          
          return `${context.join("")} ${message}${metaStr}`;
        }),
      ),
    }),
  ],
});

if (process.env.CLOUDWATCH_ENABLED === "true") {
  logger.add(
    new winston.transports.CloudWatch({
      logGroupName: LOG_GROUP_NAME,
      logStreamName: LOG_STREAM_NAME,
      awsRegion: AWS_REGION,
      jsonMessage: true,
      messageFormatter: ({ level, message, meta }) => {
        return JSON.stringify({
          timestamp: new Date().toISOString(),
          level,
          message,
          correlationId:
            meta && meta.correlationId
              ? meta.correlationId
              : currentCorrelationId,
          ...meta,
        });
      },
    }),
  );
}

// Custom metrics helper (unchanged)
const {
  CloudWatchClient,
  PutMetricDataCommand,
} = require("@aws-sdk/client-cloudwatch");
const cwClient = new CloudWatchClient({ region: AWS_REGION });
const putMetric = async (
  metricName,
  value,
  unit = "Count",
  dimensions = [],
) => {
  if (process.env.CLOUDWATCH_ENABLED !== "true") return;
  try {
    const params = {
      Namespace: "POC-Payment-System",
      MetricData: [
        {
          MetricName: metricName,
          Value: value,
          Unit: unit,
          Timestamp: new Date(),
          Dimensions: [
            {
              Name: "Environment",
              Value: process.env.AWS_ENVIRONMENT || "local-dev",
            },
            ...dimensions,
          ],
        },
      ],
    };
    await cwClient.send(new PutMetricDataCommand(params));
  } catch (error) {
    logger.error("[CW] Metric error:", { error: error.message });
  }
};

// Helper function to log with additional context
const logWithContext = (level, message, context = {}) => {
  logger[level](message, {
    ...context,
    timestamp: new Date().toISOString(),
  });
};

module.exports = {
  putMetric,
  logger,
  setCorrelationId,
  getCorrelationId,
  setRequestId,
  getRequestId,
  setUserId,
  getUserId,
  logWithContext,
};
