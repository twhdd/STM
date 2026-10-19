const mongoose = require("mongoose");

const detectionMetricsSchema = new mongoose.Schema(
  {
    totalDetectionEvents: { type: Number, required: true, min: 0 },
    perClassDetectionEvents: { type: Map, of: Number, default: {} },
    averageDetectionsPerProcessedFrame: { type: Number, required: true, min: 0 },
    framesProcessed: { type: Number, required: true, min: 0 },
    processingTimeSeconds: { type: Number, required: true, min: 0 },
    processingFps: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const jobMetricsSchema = new mongoose.Schema(
  {
    detection: { type: detectionMetricsSchema, required: true },
    tracking: { type: mongoose.Schema.Types.Mixed, default: null },
    flow: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const jobErrorSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      enum: [
        "UPLOAD_INTERRUPTED",
        "PROCESS_FAILED",
        "PROCESS_TIMEOUT",
        "INVALID_OUTPUT",
        "OUTPUT_MISSING",
      ],
      required: true,
    },
    message: { type: String, maxlength: 256, required: true },
  },
  { _id: false }
);

const cvProcessingJobSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    accessScope: {
      type: String,
      enum: ["OWNER_AND_AUTHORIZED_STAFF"],
      default: "OWNER_AND_AUTHORIZED_STAFF",
      required: true,
    },
    idempotencyKey: { type: String, maxlength: 128, select: false },
    status: {
      type: String,
      enum: ["QUEUED", "PROCESSING", "COMPLETED", "FAILED"],
      default: "QUEUED",
      required: true,
    },
    queueSlot: { type: Number, min: 0, select: false },
    uploadReady: { type: Boolean, default: false, required: true, select: false },
    uploadLeaseUntil: { type: Date, select: false },
    uploadPath: { type: String, required: true, select: false },
    resultPath: { type: String, select: false },
    annotatedPath: { type: String, select: false },
    originalFilename: { type: String, maxlength: 255, required: true },
    uploadBytes: { type: Number, min: 0, default: 0, required: true },
    uploadSha256: { type: String, default: "" },
    annotatedRequested: { type: Boolean, default: false, required: true },
    tracking: { type: Boolean, default: true, required: true },
    leaseToken: { type: String, select: false },
    leaseUntil: { type: Date, select: false },
    attempts: { type: Number, default: 0, min: 0, required: true },
    processingStartedAt: Date,
    completedAt: Date,
    processingDurationMs: { type: Number, min: 0 },
    metrics: { type: jobMetricsSchema, default: undefined },
    measurementIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "TrafficMeasurement" }],
      default: [],
    },
    measurementMapping: {
      type: String,
      default:
        "No standard traffic measurements were created: video analysis provides no validated speed, density, device, or location.",
      maxlength: 256,
    },
    error: { type: jobErrorSchema, default: undefined },
    retentionCleanedAt: Date,
  },
  { timestamps: true, autoIndex: false }
);

cvProcessingJobSchema.index(
  { owner: 1, idempotencyKey: 1 },
  {
    name: "cv_job_owner_idempotency",
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  }
);
cvProcessingJobSchema.index(
  { queueSlot: 1 },
  {
    name: "cv_job_active_queue_slot",
    unique: true,
    partialFilterExpression: { queueSlot: { $type: "number" } },
  }
);
cvProcessingJobSchema.index(
  { status: 1, uploadReady: 1, createdAt: 1 },
  { name: "cv_job_queue_order" }
);
cvProcessingJobSchema.index(
  { status: 1, leaseUntil: 1 },
  { name: "cv_job_processing_lease" }
);
cvProcessingJobSchema.index(
  { status: 1, completedAt: 1 },
  { name: "cv_job_retention" }
);
cvProcessingJobSchema.index(
  { owner: 1, createdAt: -1 },
  { name: "cv_job_owner_history" }
);

module.exports =
  mongoose.models.CVProcessingJob ||
  mongoose.model("CVProcessingJob", cvProcessingJobSchema);
