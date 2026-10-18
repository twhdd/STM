const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_ATTEMPTS,
  MAX_RETRY_DELAY_MS,
  createTrafficMeasurementRecoveryWorker,
  retryDelay,
} = require("../services/trafficMeasurementRecoveryWorker");

function createMemoryRepository(initialMeasurements = []) {
  const measurements = new Map(
    initialMeasurements.map((measurement) => [
      String(measurement._id),
      structuredClone(measurement),
    ])
  );
  const leases = new Map();
  const now = () => new Date("2026-01-01T00:00:00.000Z");
  const owned = (measurementId, token) => {
    const measurement = measurements.get(String(measurementId));
    if (measurement?.processing?.leaseToken !== token) {
      throw new Error("lease lost");
    }
    return measurement;
  };

  return {
    measurements,
    leases,
    async ensureIndexes() {},
    async getMeasurement(id) {
      const measurement = measurements.get(String(id));
      return measurement ? structuredClone(measurement) : null;
    },
    async acquireLocationLease(locationId, token, current, expiresAt) {
      const lease = leases.get(String(locationId));
      if (lease && lease.expiresAt > current) return false;
      leases.set(String(locationId), { token, expiresAt });
      return true;
    },
    async findLocationHead(locationId) {
      return [...measurements.values()]
        .filter(
          ({ location, processing }) =>
            String(location) === String(locationId) &&
            ["PENDING", "RETRY", "PROCESSING"].includes(processing?.status)
        )
        .sort(
          (left, right) =>
            left.createdAt - right.createdAt ||
            String(left._id).localeCompare(String(right._id))
        )[0] || null;
    },
    async claimMeasurement(id, token, current, expiresAt, maxAttempts) {
      const measurement = measurements.get(String(id));
      const state = measurement?.processing;
      const eligible =
        state?.status === "PENDING" ||
        (state?.status === "RETRY" &&
          (!state.nextAttemptAt || state.nextAttemptAt <= current)) ||
        (state?.status === "PROCESSING" &&
          (!state.leaseUntil || state.leaseUntil <= current));
      if (!eligible || state.attempts >= maxAttempts) return null;
      state.status = "PROCESSING";
      state.attempts += 1;
      state.leaseToken = token;
      state.leaseUntil = expiresAt;
      delete state.nextAttemptAt;
      delete state.lastError;
      return structuredClone(measurement);
    },
    async renewLeases(locationId, measurementId, token, expiresAt) {
      const lease = leases.get(String(locationId));
      if (lease?.token !== token) throw new Error("location lease lost");
      lease.expiresAt = expiresAt;
      owned(measurementId, token).processing.leaseUntil = expiresAt;
    },
    async checkpoint(
      id,
      token,
      { stage, eventId, alertId, alertCreated, message }
    ) {
      const { processing } = owned(id, token);
      processing.stage = stage;
      if (eventId !== undefined) processing.eventId = eventId;
      if (alertId !== undefined) processing.alertId = alertId;
      if (alertCreated !== undefined || message !== undefined) {
        processing.result ||= {};
        if (alertCreated !== undefined) {
          processing.result.alertCreated = alertCreated;
        }
        if (message !== undefined) processing.result.message = message;
      }
    },
    async complete(id, token, completedAt, result) {
      const { processing } = owned(id, token);
      processing.status = "COMPLETED";
      processing.completedAt = completedAt;
      processing.result ||= {};
      for (const key of [
        "congestionDetected",
        "congestionLevel",
        "alertCreated",
        "message",
      ]) {
        if (result[key] !== undefined) processing.result[key] = result[key];
      }
      delete processing.leaseToken;
      delete processing.leaseUntil;
    },
    async fail(id, token, { status, nextAttemptAt, lastError }) {
      const { processing } = owned(id, token);
      processing.status = status;
      processing.lastError = lastError;
      if (nextAttemptAt) processing.nextAttemptAt = nextAttemptAt;
      delete processing.leaseToken;
      delete processing.leaseUntil;
    },
    async markExhausted(id, current, lastError) {
      const { processing } = measurements.get(String(id));
      if (processing.attempts < MAX_ATTEMPTS) return false;
      processing.status = "FAILED";
      processing.lastError = lastError;
      return true;
    },
    async releaseLocationLease(locationId, token, current) {
      const lease = leases.get(String(locationId));
      if (lease?.token === token) lease.expiresAt = current;
    },
    async findReadyLocationHeads(current, limit) {
      const byLocation = new Map();
      for (const measurement of measurements.values()) {
        if (!["PENDING", "RETRY", "PROCESSING"].includes(measurement.processing?.status)) {
          continue;
        }
        const locationKey = String(measurement.location);
        const head = byLocation.get(locationKey);
        if (
          !head ||
          measurement.createdAt < head.createdAt ||
          (measurement.createdAt.getTime() === head.createdAt.getTime() &&
            String(measurement._id) < String(head._id))
        ) {
          byLocation.set(locationKey, measurement);
        }
      }
      return [...byLocation.values()]
        .filter(({ processing }) => {
          if (processing.status === "PENDING") return true;
          if (processing.status === "RETRY") {
            return !processing.nextAttemptAt || processing.nextAttemptAt <= current;
          }
          return !processing.leaseUntil || processing.leaseUntil <= current;
        })
        .sort((left, right) => left.createdAt - right.createdAt)
        .slice(0, limit)
        .map(({ location, _id }) => ({
          _id: location,
          head: { measurementId: _id },
        }));
    },
  };
}

function makeMeasurement(id, location, createdAt, processing = {}) {
  return {
    _id: id,
    location,
    createdAt: new Date(createdAt),
    processing: {
      status: "PENDING",
      attempts: 0,
      ...processing,
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createWorker(repository, overrides = {}) {
  let current = new Date("2026-01-01T00:00:00.000Z");
  const worker = createTrafficMeasurementRecoveryWorker({
    repository,
    now: () => new Date(current),
    random: () => 0.5,
    createToken: (() => {
      let id = 0;
      return () => `lease-${++id}`;
    })(),
    setIntervalFunction: () => ({ unref() {} }),
    clearIntervalFunction() {},
    logger: { error() {} },
    pollIntervalMs: 60000,
    heartbeatIntervalMs: 60000,
    ...overrides,
  });
  return {
    worker,
    advance(milliseconds) {
      current = new Date(current.getTime() + milliseconds);
    },
    advanceTo(date) {
      current = new Date(date);
    },
    setTime(date) {
      current = new Date(date);
    },
  };
}

describe("durable traffic-measurement recovery worker", () => {
  test("ignores legacy measurements without recovery metadata", async () => {
    const repository = createMemoryRepository([
      { _id: "legacy", location: "loc", createdAt: new Date() },
    ]);
    let calls = 0;
    const { worker } = createWorker(repository, {
      processingService: {
        async processTrafficMeasurement() {
          calls += 1;
        },
      },
    });

    const result = await worker.processMeasurementNow("legacy");
    assert.equal(result.completed, false);
    assert.match(result.message, /legacy.*not reprocessed/i);
    assert.equal(calls, 0);
  });

  test("returns the persisted result when a polling worker wins the initial claim", async () => {
    const repository = createMemoryRepository([
      makeMeasurement("already-completed", "loc1", "2026-01-01T00:00:00.000Z", {
        status: "COMPLETED",
        result: {
          congestionDetected: true,
          congestionLevel: "SEVERE",
          alertCreated: true,
          message: "Traffic alert created successfully",
        },
        eventId: "event-1",
        alertId: "alert-1",
      }),
    ]);
    let calls = 0;
    const { worker } = createWorker(repository, {
      processingService: {
        async processTrafficMeasurement() {
          calls += 1;
        },
      },
    });

    assert.deepEqual(
      await worker.processMeasurementNow("already-completed"),
      {
        completed: true,
        congestionDetected: true,
        congestionLevel: "SEVERE",
        alertCreated: true,
        message: "Traffic alert created successfully",
        eventId: "event-1",
        alertId: "alert-1",
      }
    );
    assert.equal(calls, 0);
  });

  test("competing workers claim one measurement once", async () => {
    const repository = createMemoryRepository([
      makeMeasurement("m1", "loc1", "2026-01-01T00:00:00.000Z"),
    ]);
    const entered = deferred();
    const finish = deferred();
    let calls = 0;
    const processingService = {
      async processTrafficMeasurement() {
        calls += 1;
        entered.resolve();
        await finish.promise;
        return { completed: true };
      },
    };
    const workerOne = createWorker(repository, { processingService }).worker;
    const workerTwo = createWorker(repository, { processingService }).worker;

    const firstRun = workerOne.processMeasurementNow("m1");
    await entered.promise;
    const competingRun = await workerTwo.processMeasurementNow("m1");
    assert.equal(competingRun.queued, true);
    finish.resolve();
    assert.equal((await firstRun).completed, true);
    assert.equal(
      (await workerTwo.processMeasurementNow("m1")).completed,
      true
    );
    assert.equal(calls, 1);
  });

  test("later measurements cannot overtake an earlier retry", async () => {
    const repository = createMemoryRepository([
      makeMeasurement("older", "loc1", "2026-01-01T00:00:00.000Z", {
        status: "RETRY",
        attempts: 1,
        nextAttemptAt: new Date("2026-01-01T00:00:10.000Z"),
      }),
      makeMeasurement("newer", "loc1", "2026-01-01T00:00:01.000Z"),
    ]);
    const order = [];
    const { worker, advanceTo } = createWorker(repository, {
      processingService: {
        async processTrafficMeasurement(id) {
          order.push(id);
          return { completed: true };
        },
      },
    });

    const newerEarly = await worker.processMeasurementNow("newer");
    assert.equal(newerEarly.queued, true);
    assert.deepEqual(order, []);
    advanceTo(new Date("2026-01-01T00:00:10.000Z"));
    assert.equal((await worker.processMeasurementNow("older")).completed, true);
    assert.equal((await worker.processMeasurementNow("newer")).completed, true);
    assert.deepEqual(order, ["older", "newer"]);
  });

  test("separate workers preserve location order while an earlier job is active", async () => {
    const repository = createMemoryRepository([
      makeMeasurement("older-active", "loc1", "2026-01-01T00:00:00.000Z"),
      makeMeasurement("newer-active", "loc1", "2026-01-01T00:00:01.000Z"),
    ]);
    const entered = deferred();
    const finish = deferred();
    const order = [];
    const processingService = {
      async processTrafficMeasurement(id) {
        order.push(id);
        if (id === "older-active") {
          entered.resolve();
          await finish.promise;
        }
        return { completed: true };
      },
    };
    const olderWorker = createWorker(repository, { processingService }).worker;
    const newerWorker = createWorker(repository, { processingService }).worker;

    const olderRun = olderWorker.processMeasurementNow("older-active");
    await entered.promise;
    assert.equal(
      (await newerWorker.processMeasurementNow("newer-active")).queued,
      true
    );
    assert.deepEqual(order, ["older-active"]);
    finish.resolve();
    assert.equal((await olderRun).completed, true);
    assert.equal(
      (await newerWorker.processMeasurementNow("newer-active")).completed,
      true
    );
    assert.deepEqual(order, ["older-active", "newer-active"]);
  });

  test("expired processing leases are recovered by a restarted worker", async () => {
    const repository = createMemoryRepository([
      makeMeasurement("expired", "loc1", "2026-01-01T00:00:00.000Z", {
        status: "PROCESSING",
        attempts: 1,
        leaseToken: "dead-process",
        leaseUntil: new Date("2025-12-31T23:59:00.000Z"),
      }),
    ]);
    repository.leases.set("loc1", {
      token: "dead-process",
      expiresAt: new Date("2025-12-31T23:59:00.000Z"),
    });
    let calls = 0;
    const restartedWorker = createWorker(repository, {
      processingService: {
        async processTrafficMeasurement() {
          calls += 1;
          return { completed: true };
        },
      },
    }).worker;

    assert.equal((await restartedWorker.processMeasurementNow("expired")).completed, true);
    assert.equal(repository.measurements.get("expired").processing.attempts, 2);
    assert.equal(calls, 1);
  });

  test("resumes from a persisted event checkpoint after an alert-stage crash", async () => {
    const repository = createMemoryRepository([
      makeMeasurement("checkpoint", "loc1", "2026-01-01T00:00:00.000Z"),
    ]);
    let failFirstAttempt = true;
    const resumes = [];
    const { worker, advanceTo } = createWorker(repository, {
      processingService: {
        async processTrafficMeasurement(id, options) {
          resumes.push(options.resumeFrom || "START");
          if (failFirstAttempt) {
            failFirstAttempt = false;
            await options.checkpoint({
              stage: "DETECTION_COMPLETED",
              eventId: "event-1",
            });
            throw new Error("alert persistence failed");
          }
          assert.equal(options.eventId, "event-1");
          await options.checkpoint({
            stage: "ALERT_COMPLETED",
            eventId: "event-1",
            alertId: "alert-1",
          });
          return { completed: true };
        },
      },
    });

    assert.equal((await worker.processMeasurementNow("checkpoint")).completed, false);
    const state = repository.measurements.get("checkpoint").processing;
    assert.equal(state.status, "RETRY");
    assert.equal(state.eventId, "event-1");
    advanceTo(state.nextAttemptAt);
    assert.equal((await worker.processMeasurementNow("checkpoint")).completed, true);
    assert.deepEqual(resumes, ["START", "DETECTION_COMPLETED"]);
    assert.equal(repository.measurements.get("checkpoint").processing.alertId, "alert-1");
  });

  test("does not repeat alert creation after its checkpoint survives a crash", async () => {
    const repository = createMemoryRepository([
      makeMeasurement("alert-checkpoint", "loc1", "2026-01-01T00:00:00.000Z"),
    ]);
    let failFirstAttempt = true;
    let alertCreations = 0;
    const { worker, advanceTo } = createWorker(repository, {
      processingService: {
        async processTrafficMeasurement(id, options) {
          if (options.resumeFrom === "ALERT_COMPLETED") {
            assert.equal(options.alertId, "alert-1");
            return { completed: true };
          }
          await options.checkpoint({
            stage: "DETECTION_COMPLETED",
            eventId: "event-1",
          });
          alertCreations += 1;
          await options.checkpoint({
            stage: "ALERT_COMPLETED",
            eventId: "event-1",
            alertId: "alert-1",
          });
          if (failFirstAttempt) {
            failFirstAttempt = false;
            throw new Error("completion update failed");
          }
          return { completed: true };
        },
      },
    });

    assert.equal(
      (await worker.processMeasurementNow("alert-checkpoint")).completed,
      false
    );
    const retryAt =
      repository.measurements.get("alert-checkpoint").processing.nextAttemptAt;
    advanceTo(retryAt);
    assert.equal(
      (await worker.processMeasurementNow("alert-checkpoint")).completed,
      true
    );
    assert.equal(alertCreations, 1);
  });

  test("retains terminal failures after exactly eight attempts", async () => {
    const repository = createMemoryRepository([
      makeMeasurement("always-fails", "loc1", "2026-01-01T00:00:00.000Z"),
    ]);
    let calls = 0;
    const { worker, advanceTo } = createWorker(repository, {
      processingService: {
        async processTrafficMeasurement() {
          calls += 1;
          throw new Error(`failure ${calls}`);
        },
      },
    });

    test("retries partial event and alert resolution failures durably", async () => {
      const repository = createMemoryRepository([
        makeMeasurement("partial-clear", "loc1", "2026-01-01T00:00:00.000Z"),
      ]);
      let failedFirstResolution = true;
      let resolutions = 0;
      const { worker, advanceTo } = createWorker(repository, {
        processingService: {
          async processTrafficMeasurement() {
            resolutions += 1;
            if (failedFirstResolution) {
              failedFirstResolution = false;
              throw new Error("alert resolution persistence failed");
            }
            return { completed: true, congestionDetected: false };
          },
        },
      });

      assert.equal((await worker.processMeasurementNow("partial-clear")).completed, false);
      let state = repository.measurements.get("partial-clear").processing;
      assert.equal(state.status, "RETRY");
      assert.match(state.lastError, /alert resolution persistence failed/);
      advanceTo(state.nextAttemptAt);
      assert.equal((await worker.processMeasurementNow("partial-clear")).completed, true);
      state = repository.measurements.get("partial-clear").processing;
      assert.equal(state.status, "COMPLETED");
      assert.equal(resolutions, 2);
    });

    let result;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      result = await worker.processMeasurementNow("always-fails");
      if (result.retryAt) {
        const state = repository.measurements.get("always-fails").processing;
        advanceTo(state.nextAttemptAt);
      }
    }
    assert.equal(result.terminal, true);
    assert.equal(calls, MAX_ATTEMPTS);
    assert.equal(
      repository.measurements.get("always-fails").processing.status,
      "FAILED"
    );
    assert.match(
      repository.measurements.get("always-fails").processing.lastError,
      /failure 8/
    );
    assert.equal(
      (await worker.processMeasurementNow("always-fails")).terminal,
      true
    );
    assert.equal(calls, MAX_ATTEMPTS);
  });

  test("retry delay uses bounded exponential backoff with jitter", () => {
    assert.equal(retryDelay(1, () => 0), 500);
    assert.equal(retryDelay(2, () => 0.5), 2000);
    assert.ok(retryDelay(30, () => 1) <= MAX_RETRY_DELAY_MS);
  });

  test("polling processes no more than its configured batch size per scan", async () => {
    const repository = createMemoryRepository([
      makeMeasurement("batch-1", "loc1", "2026-01-01T00:00:00.000Z"),
      makeMeasurement("batch-2", "loc2", "2026-01-01T00:00:01.000Z"),
      makeMeasurement("batch-3", "loc3", "2026-01-01T00:00:02.000Z"),
    ]);
    const processed = [];
    const { worker } = createWorker(repository, {
      batchSize: 2,
      processingService: {
        async processTrafficMeasurement(id) {
          processed.push(id);
          return { completed: true };
        },
      },
    });

    await worker.start();
    assert.equal(processed.length, 2);
    await worker.stop();
  });

  test("worker startup ensures indexes and shutdown drains active processing", async () => {
    const repository = createMemoryRepository([
      makeMeasurement("drain", "loc1", "2026-01-01T00:00:00.000Z"),
    ]);
    const entered = deferred();
    const finish = deferred();
    let indexEnsured = false;
    repository.ensureIndexes = async () => {
      indexEnsured = true;
    };
    const processingService = {
      async processTrafficMeasurement() {
        entered.resolve();
        await finish.promise;
        return { completed: true };
      },
    };
    const { worker } = createWorker(repository, { processingService });
    const processing = worker.processMeasurementNow("drain");
    await entered.promise;
    const stopping = worker.stop();
    assert.equal(worker.getState().stopping, true);
    finish.resolve();
    await Promise.all([processing, stopping]);

    const secondWorker = createWorker(repository, {
      processingService: {
        async processTrafficMeasurement() {
          return { completed: true };
        },
      },
    }).worker;
    await secondWorker.start();
    assert.equal(indexEnsured, true);
    assert.equal(secondWorker.getState().started, true);
    await secondWorker.stop();
    assert.equal(secondWorker.getState().started, false);
  });
});
