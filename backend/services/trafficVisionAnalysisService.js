const fs = require("node:fs/promises");
const path = require("node:path");
const { VIDEO_TYPES } = require("../config/trafficVision");

const SUPPORTED_CLASSES = new Set([
  "car",
  "motorcycle",
  "bus",
  "truck",
]);

class TrafficVisionAnalysisError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TrafficVisionAnalysisError";
    this.code = code;
  }
}

function invalidOutput(message) {
  throw new TrafficVisionAnalysisError("INVALID_OUTPUT", message);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validateCountMap(value, expectedTotal, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalidOutput(`${field} must be an object`);
  }
  let total = 0;
  for (const [className, count] of Object.entries(value)) {
    if (
      !SUPPORTED_CLASSES.has(className) ||
      !Number.isSafeInteger(count) ||
      count < 0
    ) {
      invalidOutput(`${field} contains an invalid class count`);
    }
    total += count;
  }
  if (total !== expectedTotal) {
    invalidOutput(`${field} total does not match its summary metric`);
  }
}

function validateAnalysisDocument(document, { tracking, annotatedRequested }) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    invalidOutput("analysis root must be an object");
  }
  if (
    document.schemaVersion !== 1 ||
    !document.video ||
    !document.configuration ||
    !Array.isArray(document.frames) ||
    !document.metrics ||
    !document.metrics.detection
  ) {
    invalidOutput("analysis document does not match schema version 1");
  }

  const video = document.video;
  if (
    typeof video.fileName !== "string" ||
    !Number.isSafeInteger(video.width) ||
    video.width <= 0 ||
    !Number.isSafeInteger(video.height) ||
    video.height <= 0 ||
    !(
      video.reportedFps === null ||
      (isFiniteNumber(video.reportedFps) && video.reportedFps > 0)
    ) ||
    !(
      video.reportedFrameCount === null ||
      (Number.isSafeInteger(video.reportedFrameCount) &&
        video.reportedFrameCount > 0)
    )
  ) {
    invalidOutput("video metadata is invalid");
  }

  let detectionEvents = 0;
  const actualClassCounts = Object.create(null);
  document.frames.forEach((frame, index) => {
    if (
      !frame ||
      frame.frameIndex !== index ||
      !(
        frame.timestampMs === null ||
        (isFiniteNumber(frame.timestampMs) && frame.timestampMs >= 0)
      ) ||
      !Array.isArray(frame.detections)
    ) {
      invalidOutput(`frame ${index} is invalid`);
    }
    for (const detection of frame.detections) {
      if (
        !detection ||
        !SUPPORTED_CLASSES.has(detection.class) ||
        !isFiniteNumber(detection.confidence) ||
        detection.confidence < 0 ||
        detection.confidence > 1 ||
        !Array.isArray(detection.bbox) ||
        detection.bbox.length !== 4 ||
        !detection.bbox.every(isFiniteNumber) ||
        detection.bbox[2] < detection.bbox[0] ||
        detection.bbox[3] < detection.bbox[1] ||
        !(
          detection.trackId === null ||
          (Number.isSafeInteger(detection.trackId) && detection.trackId >= 0)
        )
      ) {
        invalidOutput(`frame ${index} contains an invalid detection`);
      }
      detectionEvents += 1;
      actualClassCounts[detection.class] =
        (actualClassCounts[detection.class] || 0) + 1;
    }
  });

  const detectionMetrics = document.metrics.detection;
  if (
    detectionMetrics.totalDetectionEvents !== detectionEvents ||
    detectionMetrics.framesProcessed !== document.frames.length ||
    !isFiniteNumber(detectionMetrics.averageDetectionsPerProcessedFrame) ||
    detectionMetrics.averageDetectionsPerProcessedFrame < 0 ||
    !isFiniteNumber(detectionMetrics.processingTimeSeconds) ||
    detectionMetrics.processingTimeSeconds < 0 ||
    !isFiniteNumber(detectionMetrics.processingFps) ||
    detectionMetrics.processingFps < 0
  ) {
    invalidOutput("detection summary metrics are invalid");
  }
  validateCountMap(
    detectionMetrics.perClassDetectionEvents,
    detectionEvents,
    "perClassDetectionEvents"
  );
  if (
    JSON.stringify(
      Object.entries(detectionMetrics.perClassDetectionEvents).sort()
    ) !== JSON.stringify(Object.entries(actualClassCounts).sort())
  ) {
    invalidOutput("per-class detection events do not match frame detections");
  }

  if (tracking !== (document.metrics.tracking !== null)) {
    invalidOutput("tracking metrics do not match the requested tracking mode");
  }
  if (tracking) {
    const trackMetrics = document.metrics.tracking;
    if (
      !Number.isSafeInteger(trackMetrics.distinctObservedTrackIds) ||
      trackMetrics.distinctObservedTrackIds < 0 ||
      !Number.isSafeInteger(trackMetrics.activeTracks) ||
      trackMetrics.activeTracks < 0 ||
      trackMetrics.activeTracks > trackMetrics.distinctObservedTrackIds
    ) {
      invalidOutput("tracking summary metrics are invalid");
    }
    validateCountMap(
      trackMetrics.perClassTrackedVehicles,
      trackMetrics.distinctObservedTrackIds,
      "perClassTrackedVehicles"
    );
    validateCountMap(
      trackMetrics.activeTracksByClass,
      trackMetrics.activeTracks,
      "activeTracksByClass"
    );
  }

  const flowMetrics = document.metrics.flow;
  if (flowMetrics !== null) {
    if (
      !tracking ||
      !flowMetrics ||
      !flowMetrics.crossings ||
      !Number.isSafeInteger(flowMetrics.crossings.negativeToPositive) ||
      flowMetrics.crossings.negativeToPositive < 0 ||
      !Number.isSafeInteger(flowMetrics.crossings.positiveToNegative) ||
      flowMetrics.crossings.positiveToNegative < 0
    ) {
      invalidOutput("directional flow metrics are invalid");
    }
  }

  if (
    typeof document.configuration !== "object" ||
    document.configuration.trackingEnabled !== tracking ||
    (annotatedRequested && document.configuration.trackingEnabled !== tracking)
  ) {
    invalidOutput("analysis configuration does not match the submitted job");
  }
  return document;
}

async function loadAndSanitizeAnalysis(outputPath, job, options) {
  let stats;
  try {
    stats = await fs.stat(outputPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new TrafficVisionAnalysisError(
        "OUTPUT_MISSING",
        "The video processor did not produce its JSON result."
      );
    }
    throw error;
  }
  if (!stats.isFile() || stats.size <= 0 || stats.size > options.maxResultBytes) {
    throw new TrafficVisionAnalysisError(
      "INVALID_OUTPUT",
      "The video processor produced an invalid or oversized JSON result."
    );
  }

  let document;
  try {
    document = JSON.parse(await fs.readFile(outputPath, "utf8"));
  } catch {
    throw new TrafficVisionAnalysisError(
      "INVALID_OUTPUT",
      "The video processor produced malformed JSON."
    );
  }

  validateAnalysisDocument(document, {
    tracking: options.tracking,
    annotatedRequested: job.annotatedRequested,
  });
  document.video.fileName = job.originalFilename;
  delete document.configuration.weightsPath;
  document.configuration.modelName = path.basename(options.modelPath);
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  await fs.writeFile(outputPath, serialized, { mode: 0o600 });
  return {
    document,
    metrics: document.metrics,
  };
}

function annotatedVideoPath(jobDirectory, jobId, attemptToken) {
  return path.join(jobDirectory, `${jobId}-${attemptToken}.mp4`);
}

function videoExtension(filename) {
  return VIDEO_TYPES[path.extname(filename).toLowerCase()] ? path.extname(filename).toLowerCase() : null;
}

module.exports = {
  TrafficVisionAnalysisError,
  annotatedVideoPath,
  loadAndSanitizeAnalysis,
  validateAnalysisDocument,
  videoExtension,
};
