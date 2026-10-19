const os = require("node:os");
const path = require("node:path");

const STAFF_ROLES = Object.freeze([
  "ADMIN",
  "TRAFFIC_AUTHORITY",
  "TRAFFIC_POLICE",
]);

const VIDEO_TYPES = Object.freeze({
  ".mp4": {
    mimeTypes: ["video/mp4"],
    signature: "ftyp",
  },
  ".mov": {
    mimeTypes: ["video/quicktime", "video/mp4"],
    signature: "ftyp",
  },
  ".avi": {
    mimeTypes: ["video/x-msvideo", "video/avi"],
    signature: "avi",
  },
  ".mkv": {
    mimeTypes: ["video/x-matroska"],
    signature: "ebml",
  },
  ".webm": {
    mimeTypes: ["video/webm"],
    signature: "ebml",
  },
});

function positiveInteger(value, fallback, name) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function loadTrafficVisionConfig(environment = process.env) {
  const dataDirectory = path.resolve(
    environment.STM_CV_DATA_DIR || path.join(os.tmpdir(), "stm-cv-private")
  );
  const pythonExecutable = environment.STM_CV_PYTHON || "python";
  const modelPath = environment.STM_CV_MODEL_PATH
    ? path.resolve(environment.STM_CV_MODEL_PATH)
    : null;
  const timeoutMs = positiveInteger(
    environment.STM_CV_TIMEOUT_MS,
    30 * 60 * 1000,
    "STM_CV_TIMEOUT_MS"
  );
  const concurrency = positiveInteger(
    environment.STM_CV_CONCURRENCY,
    1,
    "STM_CV_CONCURRENCY"
  );
  const queueCapacity = positiveInteger(
    environment.STM_CV_QUEUE_CAPACITY,
    10,
    "STM_CV_QUEUE_CAPACITY"
  );
  const maxUploadBytes = positiveInteger(
    environment.STM_CV_MAX_UPLOAD_BYTES,
    500 * 1024 * 1024,
    "STM_CV_MAX_UPLOAD_BYTES"
  );
  const retentionDays = positiveInteger(
    environment.STM_CV_RETENTION_DAYS,
    7,
    "STM_CV_RETENTION_DAYS"
  );
  const pollIntervalMs = positiveInteger(
    environment.STM_CV_POLL_INTERVAL_MS,
    1000,
    "STM_CV_POLL_INTERVAL_MS"
  );

  return Object.freeze({
    dataDirectory,
    uploadsDirectory: path.join(dataDirectory, "uploads"),
    outputsDirectory: path.join(dataDirectory, "outputs"),
    pythonExecutable,
    modelPath,
    timeoutMs,
    leaseMs: timeoutMs + 60_000,
    concurrency,
    queueCapacity,
    totalCapacity: concurrency + queueCapacity,
    maxUploadBytes,
    retentionDays,
    pollIntervalMs,
    pythonWorkingDirectory: path.resolve(__dirname, "../../ai-service"),
    pythonModule: "traffic_vision.cli",
    defaultDevice: environment.STM_CV_DEVICE || "auto",
    confidence: Number(environment.STM_CV_CONFIDENCE || 0.25),
  });
}

module.exports = {
  STAFF_ROLES,
  VIDEO_TYPES,
  loadTrafficVisionConfig,
};
