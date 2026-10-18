const { after, before, describe, mock, test } = require("node:test");
const assert = require("node:assert/strict");
const { fork } = require("node:child_process");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const path = require("node:path");

const {
  assertConnectedDatabaseName,
  validateIntegrationEnvironment,
} = require("../scripts/seed-test-data");
const app = require("../server");
const TrafficLocation = require("../models/TrafficLocation");
const MonitoringDevice = require("../models/MonitoringDevice");
const TrafficMeasurement = require("../models/TrafficMeasurement");
const CongestionEvent = require("../models/CongestionEvent");
const TrafficAlert = require("../models/TrafficAlert");
const TrafficMeasurementProcessingLease = require("../models/TrafficMeasurementProcessingLease");
const congestionDetectionService = require("../services/congestionDetectionService");
const trafficAlertService = require("../services/trafficAlertService");
const trafficMeasurementProcessingService = require("../services/trafficMeasurementProcessingService");
const { createTrafficSimulator } = require("../services/trafficSimulatorService");
const {
  ensureCongestionLifecycleIndexes,
} = require("../services/congestionLifecycleIndexService");

const integrationEnabled =
  process.env.STM_RUN_TRAFFIC_PROCESSING_INTEGRATION === "YES";

describe(
  "traffic measurement processing MongoDB integration",
  { skip: !integrationEnabled },
  () => {
    let server;
    let baseUrl;

    before(async () => {
      const configuration = validateIntegrationEnvironment(process.env);
      if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET must be configured for integration tests.");
      }

      await mongoose.connect(configuration.mongoUri, {
        dbName: configuration.databaseName,
        autoIndex: false,
      });
      assertConnectedDatabaseName(
        mongoose.connection.name,
        configuration.databaseName
      );
      await ensureCongestionLifecycleIndexes();

      await new Promise((resolve) => {
        server = app.listen(0, "127.0.0.1", resolve);
      });
      baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
      if (server) {
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      }
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    });

    test("persists measurements and automatically processes congestion, alerts, duplicates, low traffic, and failures", async () => {
      const fixtureTag = `stm-processing-it-${Date.now()}-${process.pid}`;
      const fixtureIds = {
        location: null,
        device: null,
        measurements: [],
      };
      const token = jwt.sign(
        {
          userId: new mongoose.Types.ObjectId().toString(),
          role: "ADMIN",
        },
        process.env.JWT_SECRET,
        { expiresIn: "10m", algorithm: "HS256" }
      );
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };

      async function request(method, path, body) {
        const response = await fetch(`${baseUrl}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await response.text();
        let data;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          throw new Error(`Expected JSON from ${method} ${path}`);
        }
        return { status: response.status, data };
      }

      async function createMeasurement(values) {
        const response = await request(
          "POST",
          "/api/traffic-measurements",
          {
            device: String(fixtureIds.device),
            location: String(fixtureIds.location),
            source: "SIMULATOR",
            ...values,
          }
        );
        assert.equal(response.status, 201);
        assert.ok(response.data.measurement?._id);
        fixtureIds.measurements.push(response.data.measurement._id);
        return response.data;
      }

      try {
        const location = await TrafficLocation.create({
          name: `${fixtureTag}-location`,
          area: "Integration test fixture",
          latitude: 12.9716,
          longitude: 77.5946,
          status: "ACTIVE",
        });
        fixtureIds.location = location._id;

        const device = await MonitoringDevice.create({
          deviceId: fixtureTag,
          deviceType: "TRAFFIC_SENSOR",
          name: `${fixtureTag}-sensor`,
          location: location._id,
          status: "ACTIVE",
        });
        fixtureIds.device = device._id;

        const congested = await createMeasurement({
          vehicleCount: 125,
          averageSpeed: 12,
          trafficDensity: "SEVERE",
        });
        assert.equal(congested.measurement.source, "API");
        assert.equal(congested.processing.completed, true);
        assert.equal(congested.processing.congestionDetected, true);
        assert.equal(congested.processing.alertCreated, true);

        const measurementId = congested.measurement._id;
        const measurementRead = await request(
          "GET",
          `/api/traffic-measurements/${measurementId}`
        );
        assert.equal(measurementRead.status, 200);
        assert.equal(String(measurementRead.data._id), measurementId);
        assert.equal(measurementRead.data.vehicleCount, 125);

        const event = await CongestionEvent.findById(
          congested.processing.eventId
        );
        assert.ok(event);
        assert.equal(String(event.measurement), measurementId);
        assert.equal(event.congestionLevel, "SEVERE");

        const eventList = await request("GET", "/api/congestion-events");
        assert.equal(eventList.status, 200);
        assert.ok(
          eventList.data.events.some(
            (item) => String(item._id) === String(event._id)
          )
        );

        const alert = await TrafficAlert.findById(congested.processing.alertId);
        assert.ok(alert);
        assert.equal(String(alert.congestionEvent), String(event._id));
        assert.equal(alert.severity, "CRITICAL");

        const alertList = await request("GET", "/api/traffic-alerts");
        assert.equal(alertList.status, 200);
        assert.ok(
          alertList.data.alerts.some(
            (item) => String(item._id) === String(alert._id)
          )
        );

        const repeated =
          await trafficMeasurementProcessingService.processTrafficMeasurement(
            measurementId
          );
        assert.equal(repeated.completed, true);
        assert.equal(repeated.alertCreated, false);
        assert.equal(
          await CongestionEvent.countDocuments({ measurement: measurementId }),
          1
        );
        assert.equal(
          await TrafficAlert.countDocuments({ congestionEvent: event._id }),
          1
        );

        const lowTraffic = await createMeasurement({
          vehicleCount: 18,
          averageSpeed: 48,
          trafficDensity: "LOW",
        });
        assert.equal(lowTraffic.processing.completed, true);
        assert.equal(lowTraffic.processing.congestionDetected, false);
        assert.equal(lowTraffic.processing.alertCreated, false);
        assert.equal(
          await CongestionEvent.countDocuments({
            measurement: lowTraffic.measurement._id,
          }),
          0
        );
        assert.equal(
          (await CongestionEvent.findById(event._id)).status,
          "RESOLVED"
        );
        assert.equal((await TrafficAlert.findById(alert._id)).status, "RESOLVED");

        const persistentCongestion = await createMeasurement({
          vehicleCount: 110,
          averageSpeed: 14,
          trafficDensity: "SEVERE",
        });
        assert.equal(persistentCongestion.processing.completed, true);
        assert.equal(persistentCongestion.processing.congestionDetected, true);
        assert.equal(persistentCongestion.processing.alertCreated, true);
        assert.notEqual(
          String(persistentCongestion.processing.eventId),
          String(congested.processing.eventId)
        );

        const clearedEpisode = await createMeasurement({
          vehicleCount: 18,
          averageSpeed: 48,
          trafficDensity: "LOW",
        });
        assert.equal(clearedEpisode.processing.completed, true);
        assert.equal(clearedEpisode.processing.congestionDetected, false);

        const resolvedEvent = await CongestionEvent.findById(
          persistentCongestion.processing.eventId
        );
        const resolvedAlert = await TrafficAlert.findById(
          persistentCongestion.processing.alertId
        );
        assert.equal(resolvedEvent.status, "RESOLVED");
        assert.ok(resolvedEvent.resolvedAt);
        assert.equal(resolvedAlert.status, "RESOLVED");
        assert.ok(resolvedAlert.resolvedAt);

        mock.method(
          trafficAlertService,
          "createCongestionAlert",
          async () => {
            throw new Error("integration alert failure");
          }
        );
        const alertFailureLog = mock.method(console, "error", () => {});
        const alertProcessingFailure = await createMeasurement({
          vehicleCount: 115,
          averageSpeed: 13,
          trafficDensity: "SEVERE",
        });
        mock.restoreAll();

        assert.equal(alertProcessingFailure.processing.completed, false);
        assert.match(
          alertProcessingFailure.processing.message,
          /measurement was saved/i
        );
        assert.equal(alertFailureLog.mock.callCount(), 1);
        assert.match(
          alertFailureLog.mock.calls[0].arguments[1].message,
          /integration alert failure/
        );
        assert.ok(
          await TrafficMeasurement.findById(
            alertProcessingFailure.measurement._id
          )
        );
        const eventWithoutAlert = await CongestionEvent.findOne({
          measurement: alertProcessingFailure.measurement._id,
        });
        assert.ok(eventWithoutAlert);
        assert.equal(
          await TrafficAlert.countDocuments({
            congestionEvent: eventWithoutAlert._id,
          }),
          0
        );

        mock.method(
          congestionDetectionService,
          "detectCongestion",
          async () => {
            throw new Error("integration detection failure");
          }
        );
        const detectionFailureLog = mock.method(console, "error", () => {});
        const detectionProcessingFailure = await createMeasurement({
          vehicleCount: 108,
          averageSpeed: 14,
          trafficDensity: "SEVERE",
        });
        mock.restoreAll();

        assert.equal(detectionProcessingFailure.processing.completed, false);
        assert.match(
          detectionProcessingFailure.processing.message,
          /measurement was saved/i
        );
        assert.equal(detectionFailureLog.mock.callCount(), 1);
        assert.match(
          detectionFailureLog.mock.calls[0].arguments[1].message,
          /integration detection failure/
        );
        assert.ok(
          await TrafficMeasurement.findById(
            detectionProcessingFailure.measurement._id
          )
        );
      } finally {
        mock.restoreAll();
        const persistedMeasurements = fixtureIds.device
          ? await TrafficMeasurement.find({ device: fixtureIds.device }).select(
              "_id"
            )
          : [];
        const measurementIds = [
          ...new Set([
            ...fixtureIds.measurements.map(String),
            ...persistedMeasurements.map((item) => String(item._id)),
          ]),
        ];
        const events = measurementIds.length
          ? await CongestionEvent.find({
              measurement: { $in: measurementIds },
            }).select("_id")
          : [];
        const eventIds = events.map((item) => item._id);
        if (eventIds.length) {
          await TrafficAlert.deleteMany({
            congestionEvent: { $in: eventIds },
          });
          await CongestionEvent.deleteMany({ _id: { $in: eventIds } });
        }
        if (measurementIds.length) {
          await TrafficMeasurement.deleteMany({
            _id: { $in: measurementIds },
          });
        }
        if (fixtureIds.device) {
          await MonitoringDevice.deleteOne({ _id: fixtureIds.device });
        }
        if (fixtureIds.location) {
          await TrafficLocation.deleteOne({ _id: fixtureIds.location });
        }
      }
    });

    test("independent backend processes create only one active event and alert", async () => {
      const fixtureTag = `stm-concurrency-it-${Date.now()}-${process.pid}`;
      const barrierId = `${fixtureTag}-barrier`;
      const barrierRecordIds = ["event", "alert"].flatMap((stage) =>
        [0, 1].map((workerId) => `${barrierId}:${stage}:${workerId}`)
      );
      let location;
      const measurementIds = [];
      const workers = [];

      try {
        location = await TrafficLocation.create({
          name: `${fixtureTag}-location`,
          area: "Concurrency integration test fixture",
          latitude: 12.9716,
          longitude: 77.5946,
          status: "ACTIVE",
        });
        const measurements = [];
        for (const measurementData of [
          {
            device: new mongoose.Types.ObjectId(),
            location: location._id,
            vehicleCount: 125,
            averageSpeed: 12,
            trafficDensity: "SEVERE",
          },
          {
            device: new mongoose.Types.ObjectId(),
            location: location._id,
            vehicleCount: 118,
            averageSpeed: 13,
            trafficDensity: "SEVERE",
          },
        ]) {
          const measurement = await TrafficMeasurement.create(measurementData);
          measurements.push(measurement);
          measurementIds.push(measurement._id);
        }

        for (const measurement of measurements) {
          workers.push(
            startProcessingWorker(
              measurement._id,
              barrierId,
              workers.length
            )
          );
        }
        await Promise.all(workers.map(({ ready }) => ready));
        for (const worker of workers) worker.start();
        const results = await Promise.all(workers.map(({ result }) => result));

        assert.equal(
          results.every(
            ({ completed, congestionDetected }) =>
              completed && congestionDetected
          ),
          true
        );
        assert.equal(
          results.filter(({ alertCreated }) => alertCreated).length,
          1
        );
        assert.equal(
          new Set(results.map(({ eventId }) => String(eventId))).size,
          1
        );
        assert.equal(
          new Set(results.map(({ alertId }) => String(alertId))).size,
          1
        );
        assert.equal(results.every(({ alertId }) => alertId), true);

        const events = await CongestionEvent.find({
          location: location._id,
          status: "ACTIVE",
        });
        assert.equal(events.length, 1);
        const eventIndex = (await CongestionEvent.collection.indexes()).find(
          ({ name }) => name === "active_congestion_event_per_location"
        );
        assert.equal(eventIndex?.unique, true);
        assert.equal(eventIndex?.key.location, 1);
        assert.equal(eventIndex?.partialFilterExpression.status, "ACTIVE");
        assert.ok(
          ["objectId", 7].includes(
            eventIndex?.partialFilterExpression.location.$type
          )
        );
        const alerts = await TrafficAlert.find({
          congestionEvent: events[0]._id,
          alertType: "CONGESTION",
          status: "ACTIVE",
        });
        assert.equal(alerts.length, 1);
        const alertIndex = (await TrafficAlert.collection.indexes()).find(
          ({ name }) => name === "active_congestion_alert_per_event"
        );
        assert.equal(alertIndex?.unique, true);
        assert.equal(alertIndex?.key.congestionEvent, 1);
        assert.equal(
          alertIndex?.partialFilterExpression.alertType,
          "CONGESTION"
        );
        assert.equal(alertIndex?.partialFilterExpression.status, "ACTIVE");
        assert.ok(
          ["objectId", 7].includes(
            alertIndex?.partialFilterExpression.congestionEvent.$type
          )
        );
      } finally {
        await Promise.all(workers.map((worker) => worker.stop()));
        await mongoose.connection
          .collection("stm_congestion_insert_barriers")
          .deleteMany({ _id: { $in: barrierRecordIds } });
        if (location) {
          const eventIds = (
            await CongestionEvent.find({ location: location._id }).select("_id")
          ).map(({ _id }) => _id);
          if (eventIds.length) {
            await TrafficAlert.deleteMany({
              congestionEvent: { $in: eventIds },
            });
            await CongestionEvent.deleteMany({ _id: { $in: eventIds } });
          }
          if (measurementIds.length) {
            await TrafficMeasurement.deleteMany({
              _id: { $in: measurementIds },
            });
          }
          await TrafficLocation.deleteOne({ _id: location._id });
        }
      }
    });

    test("independent recovery workers claim one job and restore an expired job after restart", async () => {
      const fixtureTag = `stm-recovery-it-${Date.now()}-${process.pid}`;
      const recoveryBarrierId = `${fixtureTag}-claim`;
      const recoveryBarrierRecordIds = [0, 1].map(
        (workerId) => `${recoveryBarrierId}:recovery-claim:${workerId}`
      );
      let location;
      let measurement;
      const workers = [];

      try {
        location = await TrafficLocation.create({
          name: `${fixtureTag}-location`,
          area: "Recovery integration test fixture",
          latitude: 12.9717,
          longitude: 77.5947,
          status: "ACTIVE",
        });
        measurement = await TrafficMeasurement.create({
          device: new mongoose.Types.ObjectId(),
          location: location._id,
          vehicleCount: 125,
          averageSpeed: 12,
          trafficDensity: "SEVERE",
        });

        workers.push(
          startProcessingWorker(measurement._id, recoveryBarrierId, 0, {
            recovery: true,
            synchronize: true,
          }),
          startProcessingWorker(measurement._id, recoveryBarrierId, 1, {
            recovery: true,
            synchronize: true,
          })
        );
        const ready = await Promise.all(workers.map(({ ready }) => ready));
        assert.notEqual(ready[0].processId, ready[1].processId);
        for (const worker of workers) worker.start();
        const claimResults = await Promise.all(workers.map(({ result }) => result));
        assert.equal(
          claimResults.every(
            ({ completed, queued }) => completed || queued
          ),
          true
        );

        let persisted = await TrafficMeasurement.findById(measurement._id)
          .select("+processing +processing.leaseToken")
          .lean();
        assert.equal(persisted.processing.status, "COMPLETED");
        assert.equal(persisted.processing.attempts, 1);
        const event = await CongestionEvent.findOne({
          location: location._id,
          status: "ACTIVE",
        });
        assert.ok(event);
        assert.equal(
          await CongestionEvent.countDocuments({
            location: location._id,
            status: "ACTIVE",
          }),
          1
        );
        assert.equal(
          await TrafficAlert.countDocuments({
            congestionEvent: event._id,
            alertType: "CONGESTION",
            status: "ACTIVE",
          }),
          1
        );

        const expiredAt = new Date(Date.now() - 60_000);
        await TrafficMeasurement.updateOne(
          { _id: measurement._id },
          {
            $set: {
              "processing.status": "PROCESSING",
              "processing.attempts": 1,
              "processing.leaseToken": "simulated-dead-worker",
              "processing.leaseUntil": expiredAt,
              "processing.stage": null,
              "processing.eventId": null,
              "processing.alertId": null,
            },
          }
        );
        await TrafficMeasurementProcessingLease.findOneAndUpdate(
          { _id: location._id },
          {
            $set: {
              token: "simulated-dead-worker",
              expiresAt: expiredAt,
            },
          },
          { upsert: true, new: true }
        );

        const restartedWorker = startProcessingWorker(
          measurement._id,
          `${fixtureTag}-restart`,
          0,
          { recovery: true, startWorker: true }
        );
        workers.push(restartedWorker);
        await restartedWorker.ready;
        restartedWorker.start();
        const restartedResult = await restartedWorker.result;
        assert.equal(restartedResult.completed, true);
        persisted = await TrafficMeasurement.findById(measurement._id)
          .select("+processing")
          .lean();
        assert.equal(persisted.processing.status, "COMPLETED");
        assert.equal(persisted.processing.attempts, 2);
        assert.equal(
          await CongestionEvent.countDocuments({
            location: location._id,
            status: "ACTIVE",
          }),
          1
        );
        assert.equal(
          await TrafficAlert.countDocuments({
            congestionEvent: event._id,
            alertType: "CONGESTION",
            status: "ACTIVE",
          }),
          1
        );
      } finally {
        await Promise.all(workers.map((worker) => worker.stop()));
        await mongoose.connection
          .collection("stm_congestion_insert_barriers")
          .deleteMany({ _id: { $in: recoveryBarrierRecordIds } });
        if (location) {
          const eventIds = (
            await CongestionEvent.find({ location: location._id }).select("_id")
          ).map(({ _id }) => _id);
          if (eventIds.length) {
            await TrafficAlert.deleteMany({
              congestionEvent: { $in: eventIds },
            });
            await CongestionEvent.deleteMany({ _id: { $in: eventIds } });
          }
          if (measurement) {
            await TrafficMeasurement.deleteOne({ _id: measurement._id });
          }
          await TrafficMeasurementProcessingLease.deleteOne({
            _id: location._id,
          });
          await TrafficLocation.deleteOne({ _id: location._id });
        }
      }
    });

    test("persists simulator measurements, processes congestion, and stops without deleting history", async () => {
      const runId = `simulatorit${Date.now()}${process.pid}`;
      const deviceId = `STM-SIM-${runId}-01`;
      const locationName = `STM Simulator ${runId} Location 01`;
      const environment = {
        ...process.env,
        NODE_ENV: "development",
        STM_TRAFFIC_SIMULATOR_ENABLED: "YES",
        STM_TRAFFIC_SIMULATOR_INTERVAL_MS: "60000",
        STM_TRAFFIC_SIMULATOR_DEVICE_COUNT: "1",
        STM_TRAFFIC_SIMULATOR_PATTERNS: "burst",
        STM_TRAFFIC_SIMULATOR_SEED: "42",
        STM_TEST_DATABASE_NAME: process.env.STM_TEST_DATABASE_NAME,
        STM_TEST_DATA_CONFIRM: "YES",
      };
      const simulator = createTrafficSimulator({
        environment,
        createRunId: () => runId,
        logger: { info() {}, warn() {}, error() {} },
      });

      try {
        assert.equal(await simulator.start(), true);
        const device = await MonitoringDevice.findOne({ deviceId });
        assert.ok(device, "simulator should create its uniquely named device");

        const measurement = await TrafficMeasurement.findOne({
          device: device._id,
          source: "SIMULATOR",
        }).sort({ measuredAt: -1 });
        assert.ok(measurement, "simulator measurement should be persisted");
        assert.equal(measurement.vehicleCount >= 100, true);

        const event = await CongestionEvent.findOne({
          measurement: measurement._id,
        });
        assert.ok(event, "simulator measurement should trigger congestion detection");
        const alert = await TrafficAlert.findOne({ congestionEvent: event._id });
        assert.ok(alert, "congestion event should generate a persisted alert");

        await simulator.stop();
        const countAfterStop = await TrafficMeasurement.countDocuments({
          device: device._id,
        });
        await simulator.runTick();
        assert.equal(
          await TrafficMeasurement.countDocuments({ device: device._id }),
          countAfterStop
        );
        assert.ok(
          await TrafficMeasurement.exists({ _id: measurement._id }),
          "stopping should retain historical measurements"
        );
      } finally {
        await simulator.stop();
        const device = await MonitoringDevice.findOne({ deviceId }).select(
          "_id location"
        );
        const location = device
          ? null
          : await TrafficLocation.findOne({ name: locationName }).select("_id");
        const measurementIds = device
          ? (
              await TrafficMeasurement.find({ device: device._id }).select(
                "_id"
              )
            ).map((item) => item._id)
          : [];
        const events = measurementIds.length
          ? await CongestionEvent.find({
              measurement: { $in: measurementIds },
            }).select("_id")
          : [];
        const eventIds = events.map((item) => item._id);
        if (eventIds.length) {
          await TrafficAlert.deleteMany({
            congestionEvent: { $in: eventIds },
          });
          await CongestionEvent.deleteMany({ _id: { $in: eventIds } });
        }
        if (measurementIds.length) {
          await TrafficMeasurement.deleteMany({ _id: { $in: measurementIds } });
        }
        if (device) {
          await MonitoringDevice.deleteOne({ _id: device._id });
          await TrafficLocation.deleteOne({ _id: device.location });
        } else if (location) {
          await TrafficLocation.deleteOne({ _id: location._id });
        }
      }
    });
  }
);

function startProcessingWorker(
  measurementId,
  barrierId,
  workerId,
  { recovery = false, synchronize = false, startWorker = false } = {}
) {
  const worker = fork(
    path.join(__dirname, "helpers", "congestionProcessingWorker.js"),
    [],
    {
      env: {
        ...process.env,
        STM_IT_MEASUREMENT_ID: String(measurementId),
        STM_IT_BARRIER_ID: barrierId,
        STM_IT_WORKER_ID: String(workerId),
        STM_IT_RECOVERY_WORKER: recovery ? "YES" : "NO",
        STM_IT_RECOVERY_BARRIER: synchronize ? "YES" : "NO",
        STM_IT_START_RECOVERY_WORKER: startWorker ? "YES" : "NO",
      },
      execArgv: [],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    }
  );
  let stderr = "";
  worker.stderr.setEncoding("utf8");
  worker.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  let resolveReady;
  let rejectReady;
  let resolveResult;
  let rejectResult;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const result = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  worker.on("message", (message) => {
    if (message.type === "ready") resolveReady(message);
    if (message.type === "result") resolveResult(message.value);
    if (message.type === "error") {
      const error = new Error(message.message);
      rejectReady(error);
      rejectResult(error);
    }
  });
  worker.on("error", (error) => {
    rejectReady(error);
    rejectResult(error);
  });
  worker.on("exit", (code) => {
    if (code !== 0) {
      const error = new Error(
        `Processing worker exited with code ${code}: ${stderr}`
      );
      rejectReady(error);
      rejectResult(error);
    }
  });

  return {
    ready,
    result,
    start() {
      worker.send({ type: "start" });
    },
    stop() {
      if (worker.exitCode !== null || worker.signalCode !== null) {
        return Promise.resolve();
      }
      const exited = new Promise((resolve) => worker.once("exit", resolve));
      worker.kill();
      return exited;
    },
  };
}
