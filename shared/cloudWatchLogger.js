const {
  CloudWatchClient,
  PutMetricDataCommand,
} = require("@aws-sdk/client-cloudwatch");
const {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  CreateLogStreamCommand,
  PutLogEventsCommand,
  DescribeLogStreamsCommand,
} = require("@aws-sdk/client-cloudwatch-logs");

const AWS_REGION = process.env.AWS_REGION || "ap-south-1";

const cwClient = new CloudWatchClient({ region: AWS_REGION });
const cwLogsClient = new CloudWatchLogsClient({ region: AWS_REGION });

const LOG_GROUP_NAME = "/local/poc-payment-system";
const LOG_STREAM_NAME = `stream-${Date.now()}`;

let logStreamReady = false;
let nextSequenceToken = null;

// Initialize log group and stream
const initializeLogStream = async () => {
  if (process.env.CLOUDWATCH_ENABLED !== "true") return;
  if (logStreamReady) return;

  try {
    // Try to create log group (will fail silently if exists)
    try {
      await cwLogsClient.send(
        new CreateLogGroupCommand({ logGroupName: LOG_GROUP_NAME }),
      );
      console.log(`[CW] Created log group: ${LOG_GROUP_NAME}`);
    } catch (err) {
      // Log group likely exists, that's fine
    }

    // Create log stream
    try {
      await cwLogsClient.send(
        new CreateLogStreamCommand({
          logGroupName: LOG_GROUP_NAME,
          logStreamName: LOG_STREAM_NAME,
        }),
      );
      console.log(`[CW] Created log stream: ${LOG_STREAM_NAME}`);
    } catch (err) {
      // Stream likely exists, that's fine
    }

    logStreamReady = true;
  } catch (error) {
    console.error("[CW] Log stream initialization error:", error.message);
  }
};

// Custom metrics helper
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
    console.error("[CW] Metric error:", error.message);
  }
};

// CloudWatch Logs helper
const logToCloudWatch = async (level, message, metadata = {}) => {
  const logLevel = process.env.LOG_LEVEL || "INFO";
  const levels = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };

  // Always log to stdout for local visibility
  const logEntry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...metadata,
  });

  console.log(logEntry);

  // Send to CloudWatch Logs if enabled
  if (process.env.CLOUDWATCH_ENABLED !== "true") return;
  if (levels[level] > levels[logLevel]) return;

  try {
    // Ensure stream is initialized
    if (!logStreamReady) {
      await initializeLogStream();
    }

    if (!logStreamReady) return; // Fail silently if stream init failed

    await cwLogsClient.send(
      new PutLogEventsCommand({
        logGroupName: LOG_GROUP_NAME,
        logStreamName: LOG_STREAM_NAME,
        logEvents: [
          {
            message: logEntry,
            timestamp: Date.now(),
          },
        ],
        sequenceToken: nextSequenceToken,
      }),
    );
  } catch (error) {
    // If sequence token is stale, clear it and retry once
    if (
      error.message &&
      error.message.includes("InvalidSequenceTokenException")
    ) {
      nextSequenceToken = null;
      try {
        const streams = await cwLogsClient.send(
          new DescribeLogStreamsCommand({
            logGroupName: LOG_GROUP_NAME,
            logStreamNamePrefix: LOG_STREAM_NAME,
          }),
        );
        if (streams.logStreams?.length > 0) {
          nextSequenceToken = streams.logStreams[0].uploadSequenceToken;
        }
      } catch (e) {
        // ignore
      }
    }
    // Log errors locally only to avoid loops
    console.error("[CW] Failed to send log:", error.message);
  }
};

module.exports = {
  putMetric,
  logToCloudWatch,
  initializeLogStream,
};
