const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { loadTrafficVisionConfig } = require("../config/trafficVision");
const CVProcessingJob = require("../models/CVProcessingJob");
const {
  TrafficVisionAnalysisError,
  loadAndSanitizeAnalysis,
} = require("./trafficVisionAnalysisService");

const MAX_CAPTURED_OUTPUT_BYTES = 512 * 1024;
const MAX_RESULT_BYTES = 256 * 1024 * 1024;
const PROCESSING_ERROR_MESSAGES = Object.freeze({
  PROCESS_FAILED: "Video processing failed.",
  PROCESS_TIMEOUT: "Video processing exceeded the configured time limit.",
  INVALID_OUTPUT: "Video processing produced an invalid result.",
  OUTPUT_MISSING: "Video processing did not produce its result file.",
  UPLOAD_INTERRUPTED: "Video upload was interrupted before processing began.",
});

function isDuplicateIndexError(error, field) {
  return error?.code === 11000 && error?.keyPattern?.[field] === 1;
}

function privatePathIsWithin(parent, candidate) {
  const relativePath = path.relative(parent, candidate);
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}

function createTrafficVisionWorker({
  Job = CVProcessingJob,
  config = loadTrafficVisionConfig(),
  realtime = require("./trafficVisionRealtimeService").trafficVisionRealtimeService,
  execFile = childProcess.execFile,
  now = () => new Date(),
  setIntervalFunction = setInterval,
  clearIntervalFunction = clearInterval,
  logger = console,
} = {}) {
  let started = false;
  let stopping = false;
  let pollTimer = null;
  let pumpPromise = null;
  const activeJobs = new Map();

  function publish(job, status) {
    realtime.publishStatus(job, status);
  }

  async function ensureDirectories() {
    await fs.mkdir(config.uploadsDirectory, { recursive: true, mode: 0o700 });
    await fs.mkdir(config.outputsDirectory, { recursive: true, mode: 0o700 });
  }

  async function cleanupAttempt(jobId, token) {
    const directory = path.join(config.outputsDirectory, String(jobId));
    const attemptPath = path.join(directory, token);
    if (!privatePathIsWithin(config.outputsDirectory, attemptPath)) return;
    await fs.rm(attemptPath, { recursive: true, force: true }).catch(() => {});
  }

  async function recoverIncompleteUploads() {
    const expiredAt = now();
    const jobs = await Job.find({
      status: "QUEUED",
      uploadReady: false,
      uploadLeaseUntil: { $lte: expiredAt },
    }).select("+uploadPath +queueSlot");

    for (const job of jobs) {
      const result = await Job.updateOne(
        {
          _id: job._id,
          status: "QUEUED",
          uploadReady: false,
          uploadLeaseUntil: { $lte: expiredAt },
        },
        {
          $set: {
            status: "FAILED",
            completedAt: expiredAt,
            error: {
              code: "UPLOAD_INTERRUPTED",
              message: PROCESSING_ERROR_MESSAGES.UPLOAD_INTERRUPTED,
            },
          },
          $unset: { queueSlot: 1, uploadLeaseUntil: 1 },
        }
      );
      if (result.modifiedCount) {
        await fs.unlink(job.uploadPath).catch(() => {});
        publish(job, "FAILED");
      }
    }
  }

  async function recoverStaleProcessingJobs() {
    const expiredAt = now();
    const staleJobs = await Job.find({
      status: "PROCESSING",
      leaseUntil: { $lte: expiredAt },
    }).select("+leaseToken +uploadPath +queueSlot");

    for (const job of staleJobs) {
      if (activeJobs.has(String(job._id))) continue;
      const token = job.leaseToken;
      const result = await Job.updateOne(
        {
          _id: job._id,
          status: "PROCESSING",
          leaseToken: token,
          leaseUntil: { $lte: expiredAt },
        },
        {
          $set: { status: "QUEUED" },
          $unset: { leaseToken: 1, leaseUntil: 1 },
        }
      );
      if (result.modifiedCount) {
        await cleanupAttempt(job._id, token);
        publish(job, "QUEUED");
      }
    }
  }

  async function cleanupExpiredFiles() {
    const cutoff = new Date(
      now().getTime() - config.retentionDays * 24 * 60 * 60 * 1000
    );
    const jobs = await Job.find({
      status: { $in: ["COMPLETED", "FAILED"] },
      completedAt: { $lte: cutoff },
      retentionCleanedAt: { $exists: false },
    }).select("+uploadPath +resultPath +annotatedPath");

    for (const job of jobs) {
      const paths = [job.uploadPath, job.resultPath, job.annotatedPath].filter(
        Boolean
      );
      for (const filePath of paths) {
        const parent = filePath === job.uploadPath
          ? config.uploadsDirectory
          : path.join(config.outputsDirectory, String(job._id));
        if (!privatePathIsWithin(parent, filePath)) continue;
        await fs.unlink(filePath).catch((error) => {
          if (error.code !== "ENOENT") {
            logger.error("Unable to remove expired computer-vision file.");
          }
        });
      }
      await Job.updateOne(
        {
          _id: job._id,
          status: { $in: ["COMPLETED", "FAILED"] },
          completedAt: { $lte: cutoff },
          retentionCleanedAt: { $exists: false },
        },
        {
          $set: { retentionCleanedAt: now() },
          $unset: {
            uploadPath: 1,
            resultPath: 1,
            annotatedPath: 1,
          },
        }
      );
    }
  }

  async function claimNextJob() {
    const claimToken = crypto.randomUUID();
    const leaseUntil = new Date(now().getTime() + config.leaseMs);
    return Job.findOneAndUpdate(
      { status: "QUEUED", uploadReady: true },
      {
        $set: {
          status: "PROCESSING",
          leaseToken: claimToken,
          leaseUntil,
          processingStartedAt: now(),
          error: undefined,
        },
        $inc: { attempts: 1 },
      },
      { new: true, sort: { createdAt: 1 } }
    ).select("+uploadPath +leaseToken +queueSlot");
  }

  function executePython(job, token, resultPath, annotationPath, tracking) {
    const args = [
      "-m",
      config.pythonModule,
      "--input",
      job.uploadPath,
      "--weights",
      config.modelPath,
      "--output",
      resultPath,
      "--device",
      config.defaultDevice,
      "--confidence",
      String(config.confidence),
    ];
    if (tracking) args.push("--tracking");
    if (job.annotatedRequested) {
      args.push("--annotated-video", annotationPath);
    }

    return new Promise((resolve, reject) => {
      let child;
      try {
        child = execFile(
          config.pythonExecutable,
          args,
          {
            cwd: config.pythonWorkingDirectory,
            shell: false,
            windowsHide: true,
            timeout: config.timeoutMs,
            killSignal: "SIGTERM",
            maxBuffer: MAX_CAPTURED_OUTPUT_BYTES,
          },
          (error) => {
            if (error) {
              const code =
                error.code === "ETIMEDOUT" || error.killed
                  ? "PROCESS_TIMEOUT"
                  : "PROCESS_FAILED";
              reject(
                new TrafficVisionAnalysisError(
                  code,
                  PROCESSING_ERROR_MESSAGES[code]
                )
              );
              return;
            }
            resolve();
          }
        );
      } catch {
        reject(
          new TrafficVisionAnalysisError(
            "PROCESS_FAILED",
            PROCESSING_ERROR_MESSAGES.PROCESS_FAILED
          )
        );
        return;
      }
      const active = activeJobs.get(String(job._id));
      if (active?.token === token) active.child = child;
    });
  }

  async function requeueOnShutdown(job, token) {
    const result = await Job.updateOne(
      { _id: job._id, status: "PROCESSING", leaseToken: token },
      {
        $set: { status: "QUEUED" },
        $unset: { leaseToken: 1, leaseUntil: 1 },
      }
    );
    if (result.modifiedCount) publish(job, "QUEUED");
  }

  async function failJob(job, token, error, startedAt) {
    const code = Object.hasOwn(PROCESSING_ERROR_MESSAGES, error?.code)
      ? error.code
      : "PROCESS_FAILED";
    const result = await Job.updateOne(
      { _id: job._id, status: "PROCESSING", leaseToken: token },
      {
        $set: {
          status: "FAILED",
          completedAt: now(),
          processingDurationMs: Math.max(0, now().getTime() - startedAt),
          error: {
            code,
            message: PROCESSING_ERROR_MESSAGES[code],
          },
        },
        $unset: {
          queueSlot: 1,
          leaseToken: 1,
          leaseUntil: 1,
        },
      }
    );
    if (result.modifiedCount) publish(job, "FAILED");
  }

  async function processClaimedJob(job, token) {
    const jobId = String(job._id);
    const startedAt = now().getTime();
    const attemptPath = path.join(
      config.outputsDirectory,
      jobId,
      token
    );
    let leaseTimer;
    try {
      if (stopping) {
        await requeueOnShutdown(job, token);
        return;
      }
      if (!config.modelPath) {
        throw new TrafficVisionAnalysisError(
          "PROCESS_FAILED",
          PROCESSING_ERROR_MESSAGES.PROCESS_FAILED
        );
      }
      await fs.access(config.modelPath);
      await fs.mkdir(attemptPath, { recursive: true, mode: 0o700 });
      const resultPath = path.join(attemptPath, "result.json");
      const annotationPath = path.join(attemptPath, "annotated.mp4");
      const tracking = true;
      const heartbeat = async () => {
        try {
          const result = await Job.updateOne(
            { _id: job._id, status: "PROCESSING", leaseToken: token },
            { $set: { leaseUntil: new Date(now().getTime() + config.leaseMs) } }
          );
          if (!result.matchedCount) {
            activeJobs.get(jobId)?.child?.kill("SIGTERM");
          }
        } catch {
          activeJobs.get(jobId)?.child?.kill("SIGTERM");
        }
      };
      leaseTimer = setInterval(heartbeat, Math.max(1000, config.leaseMs / 3));
      leaseTimer.unref?.();

      await executePython(job, token, resultPath, annotationPath, tracking);
      const { metrics } = await loadAndSanitizeAnalysis(resultPath, job, {
        tracking,
        annotatedRequested: job.annotatedRequested,
        modelPath: config.modelPath,
        maxResultBytes: MAX_RESULT_BYTES,
      });
      if (job.annotatedRequested) {
        const annotationStats = await fs.stat(annotationPath).catch(() => null);
        if (!annotationStats?.isFile() || annotationStats.size <= 0) {
          throw new TrafficVisionAnalysisError(
            "OUTPUT_MISSING",
            PROCESSING_ERROR_MESSAGES.OUTPUT_MISSING
          );
        }
      }

      const result = await Job.updateOne(
        { _id: job._id, status: "PROCESSING", leaseToken: token },
        {
          $set: {
            status: "COMPLETED",
            completedAt: now(),
            processingDurationMs: Math.max(0, now().getTime() - startedAt),
            metrics,
            resultPath,
            ...(job.annotatedRequested ? { annotatedPath: annotationPath } : {}),
            measurementIds: [],
          },
          $unset: {
            queueSlot: 1,
            leaseToken: 1,
            leaseUntil: 1,
          },
        }
      );
      if (result.modifiedCount) {
        publish(job, "COMPLETED");
      } else {
        await cleanupAttempt(job._id, token);
      }
    } catch (error) {
      await cleanupAttempt(job._id, token);
      if (stopping) {
        await requeueOnShutdown(job, token);
      } else {
        await failJob(job, token, error, startedAt);
      }
    } finally {
      if (leaseTimer) clearInterval(leaseTimer);
    }
  }

  async function pump() {
    if (!started || stopping || pumpPromise) return pumpPromise;
    pumpPromise = (async () => {
      await recoverIncompleteUploads();
      await recoverStaleProcessingJobs();
      await cleanupExpiredFiles();
      while (!stopping && activeJobs.size < config.concurrency) {
        const job = await claimNextJob();
        if (!job) break;
        const token = job.leaseToken;
        publish(job, "PROCESSING");
        const jobId = String(job._id);
        const promise = processClaimedJob(job, token)
          .catch(() => {
            logger.error("Computer-vision job worker failed unexpectedly.");
          })
          .finally(() => {
            activeJobs.delete(jobId);
            if (started && !stopping) void pump();
          });
        activeJobs.set(jobId, { token, child: null, promise });
      }
    })().finally(() => {
      pumpPromise = null;
    });
    return pumpPromise;
  }

  return {
    async start() {
      if (started) return;
      stopping = false;
      await ensureDirectories();
      await Job.createIndexes();
      started = true;
      pollTimer = setIntervalFunction(() => {
        void pump().catch(() =>
          logger.error("Computer-vision job queue polling failed.")
        );
      }, config.pollIntervalMs);
      pollTimer?.unref?.();
      await pump();
    },

    async stop() {
      if (!started || stopping) return;
      stopping = true;
      if (pollTimer) clearIntervalFunction(pollTimer);
      pollTimer = null;
      for (const { child } of activeJobs.values()) {
        child?.kill("SIGTERM");
      }
      await Promise.allSettled(
        [...activeJobs.values()].map(({ promise }) => promise)
      );
      started = false;
    },

    async notifyQueueChanged() {
      if (started && !stopping) await pump();
    },

    getState() {
      return {
        started,
        stopping,
        activeJobs: activeJobs.size,
        concurrency: config.concurrency,
        queueCapacity: config.queueCapacity,
      };
    },

    getConfig() {
      return config;
    },

    publishStatus(job, status) {
      publish(job, status);
    },
  };
}

const trafficVisionWorker = createTrafficVisionWorker();

module.exports = {
  MAX_CAPTURED_OUTPUT_BYTES,
  PROCESSING_ERROR_MESSAGES,
  createTrafficVisionWorker,
  isDuplicateIndexError,
  privatePathIsWithin,
  trafficVisionWorker,
};
