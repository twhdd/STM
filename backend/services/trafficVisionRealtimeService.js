const CVProcessingJob = require("../models/CVProcessingJob");
const { STAFF_ROLES } = require("../config/trafficVision");

const TRAFFIC_VISION_EVENTS = Object.freeze({
  JOB_STATUS: "traffic-vision:status",
});

function safeJobPayload(job, statusOverride) {
  const status = statusOverride || job.status;
  return {
    jobId: String(job._id || job.id),
    status,
    originalFilename: job.originalFilename,
    uploadBytes: job.uploadBytes ?? 0,
    attempts: job.attempts ?? 0,
    createdAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
    updatedAt: job.updatedAt ? new Date(job.updatedAt).toISOString() : null,
    processingStartedAt: job.processingStartedAt
      ? new Date(job.processingStartedAt).toISOString()
      : null,
    completedAt: job.completedAt
      ? new Date(job.completedAt).toISOString()
      : null,
    processingDurationMs: job.processingDurationMs ?? null,
    metrics: job.metrics || null,
    measurementIds: (job.measurementIds || []).map(String),
    measurementMapping: job.measurementMapping || null,
    error: job.error
      ? { code: job.error.code, message: job.error.message }
      : null,
  };
}

function createTrafficVisionRealtimeService({
  Job = CVProcessingJob,
  logger = console,
} = {}) {
  let io = null;
  const connectionListeners = new WeakMap();

  function publish(job, status) {
    if (!io || !job) return;

    try {
      const payload = safeJobPayload(job, status);
      const ownerId = job.owner ? String(job.owner) : null;
      const jobId = String(job._id || job.id);

      let target = io;
      if (ownerId) {
        target = target.to(`user:${ownerId}`);
      }
      target = target.to("traffic-vision:staff").to(`traffic-vision:job:${jobId}`);

      target.emit(TRAFFIC_VISION_EVENTS.JOB_STATUS, payload);
    } catch (error) {
      logger.error("Failed to publish traffic vision realtime event:", error);
    }
  }

  return {
    attach(socketServer) {
      io = socketServer;
      if (!socketServer) return;

      const onConnection = (socket) => {
        const user = socket.data?.user;
        if (user?.userId) {
          socket.join(`user:${user.userId}`);
        }
        if (user?.role && STAFF_ROLES.includes(user.role)) {
          socket.join("traffic-vision:staff");
        }

        socket.on("traffic-vision:subscribe", async (jobId) => {
          try {
            if (!jobId || typeof jobId !== "string") return;
            const user = socket.data?.user;
            if (!user) return;

            if (STAFF_ROLES.includes(user.role)) {
              socket.join(`traffic-vision:job:${jobId}`);
              return;
            }

            const existingJob = await Job.findById(jobId).select("owner");
            if (existingJob && String(existingJob.owner) === String(user.userId)) {
              socket.join(`traffic-vision:job:${jobId}`);
            }
          } catch {
            // Ignore socket subscription lookup errors
          }
        });

        socket.on("traffic-vision:unsubscribe", (jobId) => {
          if (jobId && typeof jobId === "string") {
            socket.leave(`traffic-vision:job:${jobId}`);
          }
        });
      };

      connectionListeners.set(socketServer, onConnection);
      socketServer.on("connection", onConnection);
    },

    detach(socketServer) {
      if (socketServer) {
        const listener = connectionListeners.get(socketServer);
        if (listener) {
          socketServer.off("connection", listener);
          connectionListeners.delete(socketServer);
        }
      }
      if (io === socketServer) {
        io = null;
      }
    },

    publishStatus(job, status) {
      publish(job, status);
    },

    publishJobStatus(job, status) {
      publish(job, status);
    },

    safeJobPayload,
  };
}

const trafficVisionRealtimeService = createTrafficVisionRealtimeService();

module.exports = {
  TRAFFIC_VISION_EVENTS,
  createTrafficVisionRealtimeService,
  safeJobPayload,
  trafficVisionRealtimeService,
};
