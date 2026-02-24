const winston = require("winston");
require("winston-cloudwatch");

const AWS_REGION = process.env.AWS_REGION || "ap-south-1";
const LOG_GROUP_NAME =
  process.env.CLOUDWATCH_LOG_GROUP || "/local/poc-payment-system";
const LOG_STREAM_NAME =
  process.env.CLOUDWATCH_LOG_STREAM || `stream-${Date.now()}`;

let currentCorrelationId = null;

const setCorrelationId = (id) => {
  currentCorrelationId = id;
};

const getCorrelationId = () => currentCorrelationId;

// Custom format to inject correlationId
const correlationIdFormat = winston.format((info) => {
  info.correlationId = currentCorrelationId;
  return info;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(correlationIdFormat(), winston.format.json()),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        correlationIdFormat(),
        winston.format.simple(),
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

module.exports = {
  putMetric,
  logger,
  setCorrelationId,
  getCorrelationId,
};
