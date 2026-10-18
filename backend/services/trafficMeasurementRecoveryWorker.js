const { randomUUID } = require("node:crypto");
const TrafficMeasurementProcessingRepository = require("./trafficMeasurementProcessingRepository");
const trafficMeasurementProcessingService = require("./trafficMeasurementProcessingService");

const MAX_ATTEMPTS = 8;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;
const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_BATCH_SIZE = 50;
const HEARTBEAT_INTERVAL_MS = 30 * 1000;
const ACTIVE_STATUSES = new Set(["PENDING", "RETRY", "PROCESSING"]);
const ERROR_MESSAGE_LIMIT = 512;

function describeError(error) {
  const message = String(error?.message || error || "Unknown processing error")
    .replace(/mongodb(?:\+srv)?:\/\/\S+/gi, "[MongoDB URI redacted]")
    .slice(0, ERROR_MESSAGE_LIMIT);
  const name = String(error?.name || "Error").slice(0, 80);
  const code =
    typeof error?.code === "string" || typeof error?.code === "number"
      ? String(error.code).slice(0, 40)
      : "";
  return [name, code, message].filter(Boolean).join(": ");
}

function retryDelay(attempt, random) {
  const ceiling = Math.min(
    MAX_RETRY_DELAY_MS,
    BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attempt - 1)
  );
  const jitter = 0.5 + Math.min(1, Math.max(0, random()));
  return Math.min(MAX_RETRY_DELAY_MS, Math.round(ceiling * jitter));
}

function createTrafficMeasurementRecoveryWorker({
  repository = TrafficMeasurementProcessingRepository,
  processingService = trafficMeasurementProcessingService,
  now = () => new Date(),
  random = Math.random,
  createToken = randomUUID,
  setIntervalFunction = setInterval,
  clearIntervalFunction = clearInterval,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  batchSize = DEFAULT_BATCH_SIZE,
  leaseMs = DEFAULT_LEASE_MS,
  heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
  logger = console,
} = {}) {
  let timer = null;
  let started = false;
  let stopping = false;
  let batchPromise = null;
  const activeOperations = new Set();

  async function processMeasurementNow(measurementId) {
    if (stopping) {
      return { completed: false, queued: true, message: "Recovery worker is stopping" };
    }
    const operation = runMeasurement(measurementId);
    activeOperations.add(operation);
    try {
      return await operation;
    } finally {
      activeOperations.delete(operation);
    }
  }

  async function runMeasurement(measurementId) {
    const initial = await repository.getMeasurement(measurementId);
    if (!initial) throw new Error("Traffic measurement not found");

    const processing = initial.processing;
    if (processing?.status === "COMPLETED") {
      return {
        completed: true,
        ...processing.result,
        eventId: processing.eventId,
        alertId: processing.alertId,
      };
    }
    if (!processing || !ACTIVE_STATUSES.has(processing.status)) {
      return {
        completed: false,
        terminal: processing?.status === "FAILED",
        message: processing
          ? `Traffic measurement processing is ${processing.status}`
          : "Legacy traffic measurement has no recovery metadata and was not reprocessed",
      };
    }

    const token = createToken();
    const startedAt = now();
    const locationId = initial.location;
    const expiresAt = new Date(startedAt.getTime() + leaseMs);
    const acquired = await repository.acquireLocationLease(
      locationId,
      token,
      startedAt,
      expiresAt
    );
    if (!acquired) {
      return {
        completed: false,
        queued: true,
        message: "An earlier measurement for this location is being processed",
      };
    }

    let heartbeat = null;
    let claimed = null;
    try {
      const head = await repository.findLocationHead(locationId);
      if (!head || String(head._id) !== String(measurementId)) {
        return {
          completed: false,
          queued: true,
          message: "An earlier measurement for this location must be processed first",
        };
      }

      if (head.processing.attempts >= MAX_ATTEMPTS) {
        const exhausted = await repository.markExhausted(
          measurementId,
          startedAt,
          "Maximum processing attempts were exhausted before this lease expired"
        );
        return {
          completed: false,
          terminal: exhausted,
          message: exhausted
            ? "Traffic processing reached its retry limit and was retained for operator review"
            : "Measurement is not due for processing",
        };
      }

      claimed = await repository.claimMeasurement(
        measurementId,
        token,
        startedAt,
        expiresAt,
        MAX_ATTEMPTS
      );
      if (!claimed) {
        return {
          completed: false,
          queued: true,
          message: "Measurement is not due for processing",
        };
      }

      let leaseError = null;
      heartbeat = setIntervalFunction(() => {
        const renewedUntil = new Date(now().getTime() + leaseMs);
        void repository
          .renewLeases(locationId, measurementId, token, renewedUntil)
          .catch((error) => {
            leaseError = error;
            logger.error(
              `Failed to renew traffic processing lease for measurement ${measurementId}:`,
              error
            );
          });
      }, heartbeatIntervalMs);
      heartbeat?.unref?.();

      const result = await processingService.processTrafficMeasurement(
        measurementId,
        {
          resumeFrom: claimed.processing.stage,
          eventId: claimed.processing.eventId,
          alertId: claimed.processing.alertId,
          result: claimed.processing.result,
          checkpoint: async (checkpoint) => {
            if (leaseError) throw leaseError;
            await repository.checkpoint(measurementId, token, checkpoint);
          },
        }
      );
      if (leaseError) throw leaseError;

      await repository.complete(measurementId, token, now(), result);
      return result;
    } catch (error) {
      if (!claimed) throw error;
      const attempt = claimed.processing.attempts;
      const terminal = attempt >= MAX_ATTEMPTS;
      const nextAttemptAt = terminal
        ? null
        : new Date(now().getTime() + retryDelay(attempt, random));
      try {
        await repository.fail(measurementId, token, {
          status: terminal ? "FAILED" : "RETRY",
          nextAttemptAt,
          lastError: describeError(error),
        });
      } catch (stateError) {
        logger.error(
          `Could not persist recovery state for measurement ${measurementId}; its lease will expire for recovery:`,
          stateError
        );
      }
      logger.error(
        `Traffic processing ${terminal ? "failed permanently" : "will retry"} for measurement ${measurementId} (attempt ${attempt}/${MAX_ATTEMPTS}):`,
        error
      );
      return {
        completed: false,
        terminal,
        attempts: attempt,
        retryAt: nextAttemptAt,
        message: terminal
          ? "Traffic processing reached its retry limit and was retained for operator review"
          : "The measurement was saved; processing failed and a retry was scheduled",
      };
    } finally {
      if (heartbeat) clearIntervalFunction(heartbeat);
      try {
        await repository.releaseLocationLease(locationId, token, now());
      } catch (error) {
        logger.error(
          `Failed to release traffic processing lease for measurement ${measurementId}; it will expire automatically:`,
          error
        );
      }
    }
  }

  async function runBatch() {
    if (!started || stopping || batchPromise) return;
    batchPromise = (async () => {
      const readyHeads = await repository.findReadyLocationHeads(
        now(),
        batchSize
      );
      for (const { head } of readyHeads) {
        if (stopping) break;
        try {
          await processMeasurementNow(head.measurementId);
        } catch (error) {
          logger.error(
            `Traffic recovery worker could not process measurement ${head.measurementId}:`,
            error
          );
        }
      }
    })();
    try {
      await batchPromise;
    } finally {
      batchPromise = null;
    }
  }

  return {
    async start() {
      if (started) return;
      stopping = false;
      await repository.ensureIndexes();
      started = true;
      timer = setIntervalFunction(() => {
        void runBatch().catch((error) =>
          logger.error("Traffic recovery polling failed:", error)
        );
      }, pollIntervalMs);
      timer?.unref?.();
      try {
        await runBatch();
      } catch (error) {
        logger.error("Traffic recovery startup scan failed:", error);
      }
    },

    async stop() {
      if (stopping) return;
      stopping = true;
      if (timer) clearIntervalFunction(timer);
      timer = null;
      if (batchPromise) await batchPromise;
      while (activeOperations.size) {
        await Promise.allSettled([...activeOperations]);
      }
      started = false;
    },

    processMeasurementNow,
    runBatch,
    getState() {
      return { started, stopping, activeOperations: activeOperations.size };
    },
  };
}

module.exports = {
  BASE_RETRY_DELAY_MS,
  DEFAULT_BATCH_SIZE,
  DEFAULT_LEASE_MS,
  DEFAULT_POLL_INTERVAL_MS,
  MAX_ATTEMPTS,
  MAX_RETRY_DELAY_MS,
  createTrafficMeasurementRecoveryWorker,
  describeError,
  retryDelay,
  trafficMeasurementRecoveryWorker: createTrafficMeasurementRecoveryWorker(),
};
