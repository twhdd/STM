const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const mongoose = require("mongoose");
const CVProcessingJob = require("../models/CVProcessingJob");
const { STAFF_ROLES } = require("../config/trafficVision");
const {
  TrafficVisionUploadError,
  describeVideoUpload,
  writeUploadedVideo,
} = require("./trafficVisionUploadService");
const {
  isDuplicateIndexError,
  trafficVisionWorker,
} = require("./trafficVisionWorker");
const { trafficVisionRealtimeService } = require("./trafficVisionRealtimeService");

class TrafficVisionHttpError extends Error {
  constructor(statusCode, message, code) {
    super(message);
    this.name = "TrafficVisionHttpError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function isDuplicateKey(error, field) {
  return (
    error?.code === 11000 &&
    (error.keyPattern?.[field] === 1 ||
      String(error.message).includes(field))
  );
}

function publicJob(job) {
  return {
    id: String(job._id),
    status: job.status,
    originalFilename: job.originalFilename,
    uploadBytes: job.uploadBytes,
    attempts: job.attempts,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    processingStartedAt: job.processingStartedAt || null,
    completedAt: job.completedAt || null,
    processingDurationMs: job.processingDurationMs ?? null,
    metrics: job.metrics || null,
    measurementIds: (job.measurementIds || []).map(String),
    measurementMapping: job.measurementMapping,
    error: job.error
      ? { code: job.error.code, message: job.error.message }
      : null,
  };
}

function safeOriginalFilename(filename) {
  const name = path.posix.basename(String(filename || "").replace(/\\/g, "/"));
  if (
    !name ||
    name.length > 255 ||
    /[\u0000-\u001f\u007f]/.test(name)
  ) {
    throw new TrafficVisionHttpError(400, "Invalid video filename.", "INVALID_UPLOAD");
  }
  return name;
}

function createTrafficVisionJobService({
  Job = CVProcessingJob,
  worker = trafficVisionWorker,
  now = () => new Date(),
  logger = console,
} = {}) {
  const config = worker.getConfig();

  async function findAuthorizedJob(id, user, select = "") {
    if (!mongoose.isValidObjectId(id)) {
      throw new TrafficVisionHttpError(400, "Invalid job ID.", "INVALID_ID");
    }
    const job = await Job.findById(id).select(
      [
        select,
        "+uploadPath",
        "+resultPath",
        "+annotatedPath",
        "+queueSlot",
        "+leaseToken",
        "+leaseUntil",
        "+uploadReady",
        "+uploadLeaseUntil",
      ]
        .filter(Boolean)
        .join(" ")
    );
    if (!job) {
      throw new TrafficVisionHttpError(404, "Video job not found.", "NOT_FOUND");
    }
    const authorizedStaff = STAFF_ROLES.includes(user.role);
    if (!authorizedStaff && String(job.owner) !== String(user.userId)) {
      throw new TrafficVisionHttpError(403, "Access to this video job is denied.", "FORBIDDEN");
    }
    return job;
  }

  async function findExistingByIdempotency(owner, idempotencyKey) {
    if (!idempotencyKey) return null;
    return Job.findOne({ owner, idempotencyKey }).select("+idempotencyKey");
  }

  async function reserveJob({
    owner,
    originalFilename,
    descriptor,
    annotatedRequested,
    tracking,
    idempotencyKey,
  }) {
    const uploadPath = path.join(
      config.uploadsDirectory,
      `${crypto.randomUUID()}${descriptor.extension}`
    );
    const uploadLeaseUntil = new Date(
      now().getTime() + Math.max(config.timeoutMs, 10 * 60 * 1000)
    );

    for (let queueSlot = 0; queueSlot < config.totalCapacity; queueSlot += 1) {
      try {
        return await Job.create({
          owner,
          status: "QUEUED",
          queueSlot,
          uploadReady: false,
          uploadLeaseUntil,
          uploadPath,
          originalFilename,
          uploadBytes: 0,
          uploadSha256: "",
          annotatedRequested,
          tracking,
          idempotencyKey,
        });
      } catch (error) {
        if (isDuplicateKey(error, "idempotencyKey")) {
          const existing = await findExistingByIdempotency(owner, idempotencyKey);
          if (existing) return { existing };
        }
        if (isDuplicateIndexError(error, "queueSlot") || isDuplicateKey(error, "queueSlot")) {
          continue;
        }
        throw error;
      }
    }
    throw new TrafficVisionHttpError(
      429,
      "The video-processing queue is full. Try again later.",
      "QUEUE_FULL"
    );
  }

  async function submit(request, user) {
    if (!mongoose.isValidObjectId(user.userId)) {
      throw new TrafficVisionHttpError(401, "Invalid authenticated user.", "INVALID_USER");
    }
    if (!config.modelPath) {
      throw new TrafficVisionHttpError(
        503,
        "Video processing is not configured on this server.",
        "PROCESSING_UNAVAILABLE"
      );
    }
    try {
      await fs.access(config.modelPath);
    } catch {
      throw new TrafficVisionHttpError(
        503,
        "Video processing is not configured on this server.",
        "PROCESSING_UNAVAILABLE"
      );
    }

    const idempotencyKey = request.get("Idempotency-Key");
    if (
      idempotencyKey !== undefined &&
      (typeof idempotencyKey !== "string" ||
        !/^[\x21-\x7e]{1,128}$/.test(idempotencyKey))
    ) {
      throw new TrafficVisionHttpError(
        400,
        "Idempotency-Key must contain 1 to 128 visible ASCII characters.",
        "INVALID_IDEMPOTENCY_KEY"
      );
    }
    const existing = await findExistingByIdempotency(
      user.userId,
      idempotencyKey
    );
    if (existing) {
      request.resume();
      return { job: existing, duplicate: true };
    }

    const descriptor = describeVideoUpload(request.headers);
    if (
      descriptor.expectedBytes !== null &&
      descriptor.expectedBytes > config.maxUploadBytes
    ) {
      throw new TrafficVisionUploadError(
        "Video exceeds the configured upload size limit",
        413,
        "UPLOAD_TOO_LARGE"
      );
    }
    const trackingOption = request.query?.tracking;
    const tracking =
      trackingOption === undefined ? true : trackingOption === "true";
    if (
      trackingOption !== undefined &&
      trackingOption !== "true" &&
      trackingOption !== "false"
    ) {
      throw new TrafficVisionHttpError(
        400,
        "tracking must be true or false.",
        "INVALID_OPTION"
      );
    }
    const annotatedOption = request.query?.annotatedVideo;
    const annotatedRequested =
      annotatedOption === "true";
    if (
      annotatedOption !== undefined &&
      annotatedOption !== "true" &&
      annotatedOption !== "false"
    ) {
      throw new TrafficVisionHttpError(
        400,
        "annotatedVideo must be true or false.",
        "INVALID_OPTION"
      );
    }

    const originalFilename = safeOriginalFilename(descriptor.originalFilename);
    await fs.mkdir(config.uploadsDirectory, { recursive: true, mode: 0o700 });
    const reserved = await reserveJob({
      owner: user.userId,
      originalFilename,
      descriptor,
      annotatedRequested,
      tracking,
      idempotencyKey,
    });
    if (reserved?.existing) {
      request.resume();
      return { job: reserved.existing, duplicate: true };
    }
    const job = reserved;

    try {
      const upload = await writeUploadedVideo(
        request,
        job.uploadPath,
        descriptor,
        config.maxUploadBytes
      );
      await Job.updateOne(
        { _id: job._id, status: "QUEUED", uploadReady: false },
        {
          $set: {
            uploadReady: true,
            uploadLeaseUntil: null,
            uploadBytes: upload.bytesWritten,
            uploadSha256: upload.sha256,
          },
        }
      );
      job.uploadReady = true;
      job.uploadBytes = upload.bytesWritten;
      publishStatus(job, "QUEUED");
      void worker.notifyQueueChanged().catch(() =>
        logger.error("Unable to wake computer-vision job worker.")
      );
      return { job, duplicate: false };
    } catch (error) {
      await fs.unlink(job.uploadPath).catch(() => {});
      const statusCode = error.statusCode || 400;
      await Job.updateOne(
        { _id: job._id, status: "QUEUED" },
        {
          $set: {
            status: "FAILED",
            completedAt: now(),
            error: {
              code: "UPLOAD_INTERRUPTED",
              message: "Video upload was interrupted before processing began.",
            },
          },
          $unset: { queueSlot: 1, uploadLeaseUntil: 1 },
        }
      );
      publishStatus(job, "FAILED");
      if (error instanceof TrafficVisionUploadError) throw error;
      throw new TrafficVisionUploadError(
        "The video upload was interrupted",
        statusCode,
        "UPLOAD_INTERRUPTED"
      );
    }
  }

  function publishStatus(job, status) {
    trafficVisionRealtimeService.publishJobStatus(job, status);
  }

  async function readStatus(id, user) {
    const job = await findAuthorizedJob(id, user);
    return publicJob(job);
  }

  async function readResults(id, user) {
    const job = await findAuthorizedJob(id, user);
    if (job.status !== "COMPLETED") {
      throw new TrafficVisionHttpError(
        409,
        "Video analysis results are not available until processing completes.",
        "RESULT_NOT_READY"
      );
    }
    if (!job.resultPath) {
      throw new TrafficVisionHttpError(
        410,
        "The retained analysis file is no longer available.",
        "FILE_EXPIRED"
      );
    }
    return job;
  }

  async function getFile(id, user, kind) {
    const job = await readResults(id, user);
    const filePath =
      kind === "annotated" ? job.annotatedPath : job.resultPath;
    if (!filePath) {
      throw new TrafficVisionHttpError(
        404,
        "Requested output is not available.",
        "OUTPUT_NOT_FOUND"
      );
    }
    const parent = path.join(config.outputsDirectory, String(job._id));
    const relative = path.relative(parent, filePath);
    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new TrafficVisionHttpError(
        404,
        "Requested output is not available.",
        "OUTPUT_NOT_FOUND"
      );
    }
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) throw new Error("not a file");
      return { job, filePath, size: stats.size, kind };
    } catch {
      throw new TrafficVisionHttpError(
        410,
        "The retained analysis file is no longer available.",
        "FILE_EXPIRED"
      );
    }
  }

  return {
    submit,
    readStatus,
    readResults,
    getFile,
    findAuthorizedJob,
    publicJob,
    reserveJob,
  };
}

const trafficVisionJobService = createTrafficVisionJobService();

module.exports = {
  TrafficVisionHttpError,
  createTrafficVisionJobService,
  publicJob,
  safeOriginalFilename,
  trafficVisionJobService,
};
