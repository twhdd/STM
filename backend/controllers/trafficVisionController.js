const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const mongoose = require("mongoose");
const CVProcessingJob = require("../models/CVProcessingJob");
const { STAFF_ROLES } = require("../config/trafficVision");
const {
  TrafficVisionHttpError,
  publicJob,
  trafficVisionJobService,
} = require("../services/trafficVisionJobService");
const { TrafficVisionUploadError } = require("../services/trafficVisionUploadService");

function handleControllerError(error, res) {
  if (
    error instanceof TrafficVisionHttpError ||
    error?.name === "TrafficVisionHttpError" ||
    error instanceof TrafficVisionUploadError ||
    error?.name === "TrafficVisionUploadError"
  ) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
      code: error.code || "REQUEST_ERROR",
    });
  }

  if (error?.name === "CastError") {
    return res.status(400).json({
      success: false,
      message: "Invalid job ID.",
      code: "INVALID_ID",
    });
  }

  console.error("Traffic Vision controller error:", error);
  return res.status(500).json({
    success: false,
    message: error?.message || "Internal server error occurred.",
    code: "SERVER_ERROR",
  });
}

const createJob = async (req, res) => {
  try {
    const result = await trafficVisionJobService.submit(req, req.user);
    const statusCode = result.duplicate ? 200 : 201;
    return res.status(statusCode).json({
      success: true,
      message: result.duplicate
        ? "Existing video job returned (idempotent submission)."
        : "Video processing job submitted successfully.",
      duplicate: result.duplicate,
      job: publicJob(result.job),
    });
  } catch (error) {
    return handleControllerError(error, res);
  }
};

const getJobs = async (req, res) => {
  try {
    const isStaff = STAFF_ROLES.includes(req.user.role);
    const filter = isStaff ? {} : { owner: req.user.userId };
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);

    const jobs = await CVProcessingJob.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit);

    return res.status(200).json({
      success: true,
      count: jobs.length,
      jobs: jobs.map(publicJob),
    });
  } catch (error) {
    return handleControllerError(error, res);
  }
};

const getJobStatus = async (req, res) => {
  try {
    const job = await trafficVisionJobService.readStatus(req.params.id, req.user);
    return res.status(200).json({
      success: true,
      job,
    });
  } catch (error) {
    return handleControllerError(error, res);
  }
};

const getJobResults = async (req, res) => {
  try {
    const job = await trafficVisionJobService.readResults(req.params.id, req.user);
    const rawContent = await fsPromises.readFile(job.resultPath, "utf8");
    const results = JSON.parse(rawContent);

    return res.status(200).json({
      success: true,
      job: publicJob(job),
      results,
    });
  } catch (error) {
    return handleControllerError(error, res);
  }
};

const getAnnotatedVideo = async (req, res) => {
  try {
    const { job, filePath, size } = await trafficVisionJobService.getFile(
      req.params.id,
      req.user,
      "annotated"
    );

    const baseName = path.posix.basename(job.originalFilename || "video");
    const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, "_");

    res.set({
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
      "Content-Disposition": `inline; filename="annotated-${safeName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    });

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : size - 1;

      if (
        isNaN(start) ||
        start >= size ||
        (parts[1] && isNaN(end)) ||
        end >= size ||
        start > end
      ) {
        res.status(416).set("Content-Range", `bytes */${size}`).end();
        return;
      }

      const chunkSize = end - start + 1;
      res.status(206).set({
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": chunkSize,
      });

      const stream = fs.createReadStream(filePath, { start, end });
      stream.on("error", (streamError) => {
        if (!res.headersSent) {
          handleControllerError(streamError, res);
        }
      });
      stream.pipe(res);
    } else {
      res.status(200).set("Content-Length", size);
      const stream = fs.createReadStream(filePath);
      stream.on("error", (streamError) => {
        if (!res.headersSent) {
          handleControllerError(streamError, res);
        }
      });
      stream.pipe(res);
    }
  } catch (error) {
    return handleControllerError(error, res);
  }
};

const downloadResultFile = async (req, res) => {
  try {
    const { job, filePath, size } = await trafficVisionJobService.getFile(
      req.params.id,
      req.user,
      "json"
    );

    res.set({
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": size,
      "Content-Disposition": `attachment; filename="analysis-${job._id}.json"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
    });

    const stream = fs.createReadStream(filePath);
    stream.on("error", (streamError) => {
      if (!res.headersSent) {
        handleControllerError(streamError, res);
      }
    });
    stream.pipe(res);
  } catch (error) {
    return handleControllerError(error, res);
  }
};

module.exports = {
  createJob,
  getJobs,
  getJobStatus,
  getJobResults,
  getAnnotatedVideo,
  downloadResultFile,
};
