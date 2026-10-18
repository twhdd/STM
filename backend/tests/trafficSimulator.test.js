const { afterEach, describe, mock, test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const TrafficMeasurement = require("../models/TrafficMeasurement");
const trafficMeasurementIngestionService = require("../services/trafficMeasurementIngestionService");
const {
  createSeededRandom,
  createTrafficSimulator,
  generateMeasurement,
  parseSimulatorConfiguration,
} = require("../services/trafficSimulatorService");

afterEach(() => mock.restoreAll());

const enabledEnvironment = (overrides = {}) => ({
  NODE_ENV: "development",
  STM_TRAFFIC_SIMULATOR_ENABLED: "YES",
  STM_TRAFFIC_SIMULATOR_INTERVAL_MS: "5000",
  STM_TRAFFIC_SIMULATOR_DEVICE_COUNT: "2",
  STM_TRAFFIC_SIMULATOR_PATTERNS: "normal,moderate,heavy,burst",
  STM_TRAFFIC_SIMULATOR_SEED: "12345",
  STM_TEST_DATABASE_NAME: "stm_test",
  STM_TEST_DATA_CONFIRM: "YES",
  MONGO_URI: "mongodb://127.0.0.1:27017/stm_test",
  ...overrides,
});

function simulatorHarness(overrides = {}) {
  const createdLocations = [];
  const createdDevices = [];
  const measurements = [];
  const errors = [];
  const infos = [];
  const intervalCalls = [];
  const clearedIntervals = [];
  let nextId = 1;

  const simulator = createTrafficSimulator({
    environment: enabledEnvironment(),
    LocationModel: {
      create: async (fields) => {
        const location = { ...fields, _id: `location-${nextId++}` };
        createdLocations.push(location);
        return location;
      },
    },
    DeviceModel: {
      create: async (fields) => {
        const device = { ...fields, _id: `device-${nextId++}` };
        createdDevices.push(device);
        return device;
      },
    },
    recordMeasurement: async (measurement) => {
      measurements.push(measurement);
      return {
        measurement: { _id: `measurement-${measurements.length}` },
        processing: {
          completed: true,
          congestionDetected: measurement.trafficDensity === "HIGH" ||
            measurement.trafficDensity === "SEVERE",
          alertCreated: measurement.trafficDensity === "SEVERE",
        },
      };
    },
    logger: {
      info: (...args) => infos.push(args),
      warn: (...args) => errors.push(args),
      error: (...args) => errors.push(args),
    },
    setIntervalFunction: (callback, intervalMs) => {
      const handle = { callback, intervalMs };
      intervalCalls.push(handle);
      return handle;
    },
    clearIntervalFunction: (handle) => clearedIntervals.push(handle),
    createRunId: () => "test-run",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    getDatabaseName: () => "stm_test",
    ...overrides,
  });

  return {
    simulator,
    createdLocations,
    createdDevices,
    measurements,
    errors,
    infos,
    intervalCalls,
    clearedIntervals,
  };
}

describe("traffic simulator configuration", () => {
  test("is disabled by default", () => {
    const configuration = parseSimulatorConfiguration({
      NODE_ENV: "development",
    });
    assert.equal(configuration.enabled, false);
  });

  test("production refuses to start even with explicit opt-in", async () => {
    const harness = simulatorHarness({
      environment: enabledEnvironment({ NODE_ENV: "production" }),
    });
    assert.equal(await harness.simulator.start(), false);
    assert.equal(harness.simulator.getState().running, false);
    assert.equal(harness.createdLocations.length, 0);
  });

  test("refuses to write unless the connected database matches the configured test database", async () => {
    const harness = simulatorHarness({
      getDatabaseName: () => "stm_production",
    });
    assert.equal(await harness.simulator.start(), false);
    assert.equal(harness.createdLocations.length, 0);
    assert.equal(harness.errors.length, 1);
  });

  test("supports a dedicated configured test database", async () => {
    const testDatabaseName = "stm_congestion_it_test";
    const harness = simulatorHarness({
      environment: enabledEnvironment({
        STM_TEST_DATABASE_NAME: testDatabaseName,
        MONGO_URI: `mongodb://127.0.0.1:27017/${testDatabaseName}`,
      }),
      getDatabaseName: () => testDatabaseName,
    });
    assert.equal(await harness.simulator.start(), true);
    assert.equal(harness.createdLocations.length, 2);
    await harness.simulator.stop();
  });

  test("refuses production-name configuration and mismatched URI databases", async () => {
    const productionName = simulatorHarness({
      environment: enabledEnvironment({
        STM_TEST_DATABASE_NAME: "stm_production_test",
        MONGO_URI: "mongodb://127.0.0.1:27017/stm_production_test",
      }),
    });
    assert.equal(await productionName.simulator.start(), false);
    assert.equal(productionName.createdLocations.length, 0);

    const wrongUriName = simulatorHarness({
      environment: enabledEnvironment({
        STM_TEST_DATABASE_NAME: "stm_congestion_it_test",
        MONGO_URI: "mongodb://127.0.0.1:27017/production",
      }),
    });
    assert.equal(await wrongUriName.simulator.start(), false);
    assert.equal(wrongUriName.createdLocations.length, 0);
  });

  test("refuses to start without the existing explicit test-data confirmation", async () => {
    const harness = simulatorHarness({
      environment: enabledEnvironment({ STM_TEST_DATA_CONFIRM: undefined }),
    });
    assert.equal(await harness.simulator.start(), false);
    assert.equal(harness.createdLocations.length, 0);
  });

  test("explicit development opt-in enables configured simulator", () => {
    const configuration = parseSimulatorConfiguration(enabledEnvironment());
    assert.equal(configuration.enabled, true);
    assert.equal(configuration.intervalMs, 5000);
    assert.equal(configuration.deviceCount, 2);
    assert.deepEqual(configuration.patterns, [
      "normal",
      "moderate",
      "heavy",
      "burst",
    ]);
    assert.equal(configuration.seed, 12345);
  });

  test("rejects invalid intervals, counts, seeds, and patterns", () => {
    for (const overrides of [
      { STM_TRAFFIC_SIMULATOR_INTERVAL_MS: "500" },
      { STM_TRAFFIC_SIMULATOR_DEVICE_COUNT: "21" },
      { STM_TRAFFIC_SIMULATOR_SEED: "-1" },
      { STM_TRAFFIC_SIMULATOR_PATTERNS: "normal,unknown" },
    ]) {
      assert.throws(
        () => parseSimulatorConfiguration(enabledEnvironment(overrides)),
        /STM_TRAFFIC_SIMULATOR_/
      );
    }
  });
});

describe("traffic simulator lifecycle and generation", () => {
  test("starts once, feeds the shared ingestion pipeline, and stops its timer", async () => {
    const harness = simulatorHarness();

    const firstStart = await harness.simulator.start();
    const secondStart = await harness.simulator.start();

    assert.equal(firstStart, true);
    assert.equal(secondStart, true);
    assert.equal(harness.createdLocations.length, 2);
    assert.equal(harness.createdDevices.length, 2);
    assert.equal(harness.intervalCalls.length, 1);
    assert.equal(harness.measurements.length, 2);
    assert.ok(harness.measurements.every((item) => item.source === "SIMULATOR"));
    assert.ok(harness.measurements.every((item) => item.device && item.location));
    assert.ok(
      harness.infos.some(([message]) =>
        String(message).includes("Data is simulated, not live traffic")
      )
    );

    await harness.simulator.stop();
    const generatedBeforeStoppedTick = harness.measurements.length;
    await harness.simulator.runTick();
    assert.equal(harness.measurements.length, generatedBeforeStoppedTick);
    assert.deepEqual(harness.clearedIntervals, [harness.intervalCalls[0]]);
    assert.equal(harness.simulator.getState().running, false);
    assert.equal(harness.createdLocations.length, 2);
    assert.equal(harness.createdDevices.length, 2);
  });

  test("uses the existing shared measurement ingestion service by default", async () => {
    const recorded = [];
    mock.method(
      trafficMeasurementIngestionService,
      "recordTrafficMeasurement",
      async (measurement) => {
        recorded.push(measurement);
        return {
          measurement: { _id: `measurement-${recorded.length}` },
          processing: {
            completed: true,
            congestionDetected: false,
            alertCreated: false,
          },
        };
      }
    );
    const harness = simulatorHarness({
      recordMeasurement: undefined,
    });

    assert.equal(await harness.simulator.start(), true);
    assert.equal(recorded.length, 2);
    assert.ok(recorded.every(({ source }) => source === "SIMULATOR"));
    await harness.simulator.stop();
  });

  test("seeded generation is reproducible", () => {
    const firstRandom = createSeededRandom(654321);
    const secondRandom = createSeededRandom(654321);
    const device = { _id: new mongoose.Types.ObjectId(), location: new mongoose.Types.ObjectId() };
    const first = ["normal", "moderate", "heavy", "burst"].map((pattern) =>
      generateMeasurement({
        device,
        pattern,
        random: firstRandom,
        measuredAt: new Date("2026-01-01T00:00:00.000Z"),
      })
    );
    const second = ["normal", "moderate", "heavy", "burst"].map((pattern) =>
      generateMeasurement({
        device,
        pattern,
        random: secondRandom,
        measuredAt: new Date("2026-01-01T00:00:00.000Z"),
      })
    );
    assert.deepEqual(first, second);
  });

  test("generated measurements satisfy the existing schema and cover all traffic patterns", async () => {
    const random = createSeededRandom(12345);
    const device = {
      _id: new mongoose.Types.ObjectId(),
      location: new mongoose.Types.ObjectId(),
    };
    const patterns = ["normal", "moderate", "heavy", "burst"];
    const generated = patterns.map((pattern) =>
      generateMeasurement({
        device,
        pattern,
        random,
        measuredAt: new Date(),
      })
    );
    for (const measurement of generated) {
      await new TrafficMeasurement(measurement).validate();
      assert.equal(measurement.source, "SIMULATOR");
    }
    assert.deepEqual(
      generated.map(({ trafficDensity }) => trafficDensity),
      ["LOW", "MEDIUM", "HIGH", "SEVERE"]
    );
    assert.ok(generated[0].averageSpeed > generated[1].averageSpeed);
    assert.ok(generated[1].averageSpeed > generated[2].averageSpeed);
    assert.ok(generated[2].averageSpeed > generated[3].averageSpeed);
  });

  test("generation and database failures are logged without escaping the tick", async () => {
    let attempts = 0;
    const harness = simulatorHarness({
      recordMeasurement: async () => {
        attempts += 1;
        throw new Error("simulated database failure");
      },
    });

    assert.equal(await harness.simulator.start(), true);
    assert.equal(attempts, 2);
    assert.equal(harness.errors.length, 2);
    assert.equal(harness.simulator.getState().running, true);

    await harness.simulator.runTick();
    assert.equal(attempts, 4);
    assert.equal(harness.simulator.getState().running, true);
    await harness.simulator.stop();
  });

  test("invalid configuration and startup failure do not crash the caller", async () => {
    const invalid = simulatorHarness({
      environment: enabledEnvironment({
        STM_TRAFFIC_SIMULATOR_INTERVAL_MS: "invalid",
      }),
    });
    assert.equal(await invalid.simulator.start(), false);
    assert.equal(invalid.errors.length, 1);

    const failedStartup = simulatorHarness({
      LocationModel: {
        create: async () => {
          throw new Error("database unavailable");
        },
      },
    });
    assert.equal(await failedStartup.simulator.start(), false);
    assert.equal(failedStartup.simulator.getState().running, false);
    assert.equal(failedStartup.errors.length, 1);
  });

  test("stop is safe when called before startup", async () => {
    const harness = simulatorHarness();
    await harness.simulator.stop();
    assert.equal(harness.simulator.getState().running, false);
    assert.equal(harness.clearedIntervals.length, 0);
  });
});
