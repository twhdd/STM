const { afterEach, describe, mock, test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const TrafficMeasurement = require("../models/TrafficMeasurement");
const trafficMeasurementIngestionService = require("../services/trafficMeasurementIngestionService");
const {
  advanceScenarioState,
  createSeededRandom,
  createScenarioState,
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
  STM_TRAFFIC_SIMULATOR_SCENARIO: "normal",
  STM_TRAFFIC_SIMULATOR_SEED: "12345",
  STM_TEST_DATABASE_NAME: "stm_test",
  STM_TEST_DATA_CONFIRM: "YES",
  MONGO_URI: "mongodb://127.0.0.1:27017/stm_test",
  ...overrides,
});

function simulatorHarness(overrides = {}) {
  const locations =
    overrides.configuredLocations ||
    [
      { _id: "location-1", status: "ACTIVE" },
      { _id: "location-2", status: "ACTIVE" },
      { _id: "location-3", status: "ACTIVE" },
    ];
  const configuredDevices =
    overrides.configuredDevices ||
    locations.map((location, index) => ({
      _id: `device-${index + 1}`,
      deviceId: `STM-SENSOR-${index + 1}`,
      deviceType: "TRAFFIC_SENSOR",
      status: "ACTIVE",
      location: location._id,
    }));
  const measurements = [];
  const errors = [];
  const infos = [];
  const warnings = [];
  const intervalCalls = [];
  const clearedIntervals = [];

  function query(results) {
    let selected = results;
    return {
      select() {
        return this;
      },
      sort() {
        return this;
      },
      limit(count) {
        selected = selected.slice(0, count);
        return this;
      },
      lean: async () => selected,
    };
  }

  const simulator = createTrafficSimulator({
    environment: enabledEnvironment(),
    LocationModel: {
      find: (filter) =>
        query(
          filter.status === "ACTIVE"
            ? locations.filter((location) => location.status === "ACTIVE")
            : []
        ),
    },
    DeviceModel: {
      find: (filter) => {
        const locationIds = new Set(filter.location.$in.map(String));
        return query(
          configuredDevices.filter(
            (device) =>
              device.status === filter.status &&
              device.deviceType === filter.deviceType &&
              locationIds.has(String(device.location))
          )
        );
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
      warn: (...args) => warnings.push(args),
      error: (...args) => errors.push(args),
    },
    setIntervalFunction: (callback, intervalMs) => {
      const handle = { callback, intervalMs };
      intervalCalls.push(handle);
      return handle;
    },
    clearIntervalFunction: (handle) => clearedIntervals.push(handle),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    getDatabaseName: () => "stm_test",
    randomSource: () => 0.5,
    ...overrides,
  });

  return {
    simulator,
    locations,
    configuredDevices,
    measurements,
    errors,
    infos,
    warnings,
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
    assert.equal(harness.measurements.length, 0);
  });

  test("refuses to write unless the connected database matches the configured test database", async () => {
    const harness = simulatorHarness({
      getDatabaseName: () => "stm_production",
    });
    assert.equal(await harness.simulator.start(), false);
    assert.equal(harness.measurements.length, 0);
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
    assert.equal(harness.measurements.length, 2);
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
    assert.equal(productionName.measurements.length, 0);

    const wrongUriName = simulatorHarness({
      environment: enabledEnvironment({
        STM_TEST_DATABASE_NAME: "stm_congestion_it_test",
        MONGO_URI: "mongodb://127.0.0.1:27017/production",
      }),
    });
    assert.equal(await wrongUriName.simulator.start(), false);
    assert.equal(wrongUriName.measurements.length, 0);
  });

  test("refuses to start without the existing explicit test-data confirmation", async () => {
    const harness = simulatorHarness({
      environment: enabledEnvironment({ STM_TEST_DATA_CONFIRM: undefined }),
    });
    assert.equal(await harness.simulator.start(), false);
    assert.equal(harness.measurements.length, 0);
  });

  test("explicit development opt-in enables configured simulator", () => {
    const configuration = parseSimulatorConfiguration(enabledEnvironment());
    assert.equal(configuration.enabled, true);
    assert.equal(configuration.intervalMs, 5000);
    assert.equal(configuration.deviceCount, 2);
    assert.equal(configuration.scenario, "normal");
    assert.equal(configuration.seed, 12345);
  });

  test("rejects invalid intervals, counts, seeds, and scenarios", () => {
    for (const overrides of [
      { STM_TRAFFIC_SIMULATOR_INTERVAL_MS: "500" },
      { STM_TRAFFIC_SIMULATOR_DEVICE_COUNT: "21" },
      { STM_TRAFFIC_SIMULATOR_SEED: "-1" },
      { STM_TRAFFIC_SIMULATOR_SCENARIO: "unknown" },
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

    const [firstStart, secondStart] = await Promise.all([
      harness.simulator.start(),
      harness.simulator.start(),
    ]);

    assert.equal(firstStart, true);
    assert.equal(secondStart, true);
    assert.equal(harness.simulator.getState().deviceCount, 2);
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
    assert.equal(harness.simulator.getState().deviceCount, 0);
  });

  test("missing active locations or configured traffic sensors safely disables generation", async () => {
    const missingLocations = simulatorHarness({ configuredLocations: [] });
    assert.equal(await missingLocations.simulator.start(), false);
    assert.equal(missingLocations.measurements.length, 0);
    assert.equal(missingLocations.intervalCalls.length, 0);

    const missingSensors = simulatorHarness({ configuredDevices: [] });
    assert.equal(await missingSensors.simulator.start(), false);
    assert.equal(missingSensors.measurements.length, 0);
    assert.equal(missingSensors.intervalCalls.length, 0);
  });

  test("only uses active sensors mapped to active locations", async () => {
    const harness = simulatorHarness({
      environment: enabledEnvironment({
        STM_TRAFFIC_SIMULATOR_DEVICE_COUNT: "3",
      }),
      configuredLocations: [
        { _id: "active-location", status: "ACTIVE" },
        { _id: "inactive-location", status: "INACTIVE" },
      ],
      configuredDevices: [
        {
          _id: "sensor-active",
          deviceId: "STM-ACTIVE",
          deviceType: "TRAFFIC_SENSOR",
          status: "ACTIVE",
          location: "active-location",
        },
        {
          _id: "sensor-inactive-location",
          deviceId: "STM-INACTIVE-LOCATION",
          deviceType: "TRAFFIC_SENSOR",
          status: "ACTIVE",
          location: "inactive-location",
        },
        {
          _id: "sensor-inactive",
          deviceId: "STM-INACTIVE",
          deviceType: "TRAFFIC_SENSOR",
          status: "INACTIVE",
          location: "active-location",
        },
        {
          _id: "non-sensor",
          deviceId: "STM-CAMERA",
          deviceType: "CCTV",
          status: "ACTIVE",
          location: "active-location",
        },
      ],
    });

    assert.equal(await harness.simulator.start(), true);
    assert.deepEqual(
      harness.measurements.map((measurement) => String(measurement.device)),
      ["sensor-active"]
    );
    await harness.simulator.stop();
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

  test("seeded scenario state and measurements are reproducible", () => {
    const firstRandom = createSeededRandom(654321);
    const secondRandom = createSeededRandom(654321);
    const device = {
      _id: new mongoose.Types.ObjectId(),
      location: new mongoose.Types.ObjectId(),
    };
    const makeSequence = (random) => {
      const state = createScenarioState("rush-hour", random);
      return Array.from({ length: 10 }, () => {
        advanceScenarioState(state);
        return generateMeasurement({
          device,
          state,
          measuredAt: new Date("2026-01-01T00:00:00.000Z"),
        });
      });
    };
    assert.deepEqual(makeSequence(firstRandom), makeSequence(secondRandom));
  });

  test("normal traffic stays steady and accepts a controllable clock", async () => {
    let timestamp = 0;
    const harness = simulatorHarness({
      environment: enabledEnvironment({
        STM_TRAFFIC_SIMULATOR_DEVICE_COUNT: "1",
      }),
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, timestamp++)),
    });

    assert.equal(await harness.simulator.start(), true);
    const first = harness.measurements[0];
    await harness.simulator.runTick();
    const second = harness.measurements[1];
    assert.equal(first.vehicleCount, 20);
    assert.equal(second.vehicleCount, first.vehicleCount);
    assert.equal(first.trafficDensity, "LOW");
    assert.equal(first.measuredAt.toISOString(), "2026-01-01T00:00:00.000Z");
    assert.equal(second.measuredAt.toISOString(), "2026-01-01T00:00:01.000Z");
    await harness.simulator.stop();
  });

  test("generated scenario measurements satisfy the existing schema", async () => {
    const random = createSeededRandom(12345);
    const device = {
      _id: new mongoose.Types.ObjectId(),
      location: new mongoose.Types.ObjectId(),
    };
    const scenarios = [
      "normal",
      "rush-hour",
      "heavy-congestion",
      "incident",
      "recovery",
    ];
    const generated = scenarios.map((scenario) => {
      const state = createScenarioState(scenario, random);
      advanceScenarioState(state);
      return generateMeasurement({
        device,
        state,
        measuredAt: new Date(),
      });
    });
    for (const measurement of generated) {
      await new TrafficMeasurement(measurement).validate();
      assert.equal(measurement.source, "SIMULATOR");
    }
    assert.deepEqual(generated.map(({ source }) => source), scenarios.map(() => "SIMULATOR"));
  });

  test("rush-hour and heavy congestion build progressively toward their targets", async () => {
    for (const [scenario, ticks] of [
      ["rush-hour", 10],
      ["heavy-congestion", 6],
    ]) {
      const harness = simulatorHarness({
        environment: enabledEnvironment({
          STM_TRAFFIC_SIMULATOR_SCENARIO: scenario,
          STM_TRAFFIC_SIMULATOR_DEVICE_COUNT: "1",
        }),
      });
      assert.equal(await harness.simulator.start(), true);
      for (let index = 1; index < ticks; index += 1) {
        await harness.simulator.runTick();
      }

      const measurements = harness.measurements;
      assert.ok(measurements.length > 1);
      assert.ok(
        measurements.every(
          (measurement, index) =>
            index === 0 ||
            (measurement.vehicleCount >= measurements[index - 1].vehicleCount &&
              measurement.averageSpeed <= measurements[index - 1].averageSpeed)
        )
      );
      assert.ok(measurements.at(-1).vehicleCount > measurements[0].vehicleCount);
      assert.ok(measurements.at(-1).averageSpeed < measurements[0].averageSpeed);
      assert.equal(harness.simulator.getState().scenario, scenario);
      await harness.simulator.stop();
    }
  });

  test("incident scenario reaches severe congestion gradually; recovery clears it gradually", async () => {
    const incident = simulatorHarness({
      environment: enabledEnvironment({
        STM_TRAFFIC_SIMULATOR_SCENARIO: "incident",
        STM_TRAFFIC_SIMULATOR_DEVICE_COUNT: "1",
      }),
    });
    assert.equal(await incident.simulator.start(), true);
    for (let index = 1; index < 5; index += 1) {
      await incident.simulator.runTick();
    }
    assert.ok(incident.measurements[0].vehicleCount < 100);
    assert.equal(incident.measurements.at(-1).trafficDensity, "SEVERE");
    assert.ok(
      incident.measurements.every(
        (measurement, index) =>
          index === 0 ||
          (measurement.vehicleCount > incident.measurements[index - 1].vehicleCount &&
            measurement.averageSpeed < incident.measurements[index - 1].averageSpeed)
      )
    );
    await incident.simulator.stop();

    const recovery = simulatorHarness({
      environment: enabledEnvironment({
        STM_TRAFFIC_SIMULATOR_SCENARIO: "recovery",
        STM_TRAFFIC_SIMULATOR_DEVICE_COUNT: "1",
      }),
    });
    assert.equal(await recovery.simulator.start(), true);
    for (let index = 1; index < 8; index += 1) {
      await recovery.simulator.runTick();
    }
    assert.equal(recovery.measurements[0].trafficDensity, "SEVERE");
    assert.equal(recovery.measurements.at(-1).trafficDensity, "LOW");
    assert.ok(
      recovery.measurements.every(
        (measurement, index) =>
          index === 0 ||
          (measurement.vehicleCount < recovery.measurements[index - 1].vehicleCount &&
            measurement.averageSpeed > recovery.measurements[index - 1].averageSpeed)
      )
    );
    await recovery.simulator.stop();
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
    assert.equal(harness.simulator.getState().failureCount, 4);
    assert.match(harness.simulator.getState().lastError, /simulated database failure/);
    await harness.simulator.stop();
    assert.equal(harness.simulator.getState().failureCount, 0);
    assert.equal(harness.simulator.getState().lastError, null);
    assert.equal(harness.simulator.getState().lastBatch, null);
  });

  test("scenario state advances by one scheduled step when ingestion fails", async () => {
    const attempted = [];
    const harness = simulatorHarness({
      environment: enabledEnvironment({
        STM_TRAFFIC_SIMULATOR_DEVICE_COUNT: "1",
        STM_TRAFFIC_SIMULATOR_SCENARIO: "rush-hour",
      }),
      recordMeasurement: async (measurement) => {
        attempted.push(measurement);
        if (attempted.length === 1) throw new Error("temporary ingestion failure");
        return { processing: { completed: true } };
      },
    });

    assert.equal(await harness.simulator.start(), true);
    await harness.simulator.runTick();
    assert.equal(attempted.length, 2);
    assert.equal(attempted[1].vehicleCount - attempted[0].vehicleCount, 8);
    assert.equal(attempted[0].averageSpeed - attempted[1].averageSpeed, 4);
    assert.equal(harness.simulator.getState().failureCount, 1);
    await harness.simulator.stop();
  });

  test("records measurements returned with incomplete downstream processing", async () => {
    const harness = simulatorHarness({
      environment: enabledEnvironment({
        STM_TRAFFIC_SIMULATOR_DEVICE_COUNT: "1",
      }),
      recordMeasurement: async () => ({
        processing: {
          completed: false,
          message: "Measurement queued for retry",
        },
      }),
    });

    assert.equal(await harness.simulator.start(), true);
    assert.equal(harness.simulator.getState().failureCount, 1);
    assert.equal(
      harness.simulator.getState().lastError,
      "Measurement queued for retry"
    );
    assert.equal(harness.simulator.getState().lastBatch.failed, 1);
    await harness.simulator.stop();
  });

  test("does not overlap ticks and waits for an in-flight tick during stop", async () => {
    let releaseIngestion;
    let ingestionEntered;
    const entered = new Promise((resolve) => {
      ingestionEntered = resolve;
    });
    const blockedIngestion = new Promise((resolve) => {
      releaseIngestion = resolve;
    });
    let blockNext = false;
    let activeCalls = 0;
    let maximumActiveCalls = 0;
    const harness = simulatorHarness({
      environment: enabledEnvironment({
        STM_TRAFFIC_SIMULATOR_DEVICE_COUNT: "1",
      }),
      recordMeasurement: async (measurement) => {
        activeCalls += 1;
        maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
        harnessMeasurements.push(measurement);
        if (blockNext) {
          blockNext = false;
          ingestionEntered();
          await blockedIngestion;
        }
        activeCalls -= 1;
        return { processing: { completed: true } };
      },
    });
    const harnessMeasurements = [];
    assert.equal(await harness.simulator.start(), true);
    blockNext = true;
    const firstTick = harness.simulator.runTick();
    await entered;
    const overlappingTick = harness.simulator.runTick();
    const stopping = harness.simulator.stop();
    releaseIngestion();
    await Promise.all([firstTick, overlappingTick, stopping]);
    assert.equal(maximumActiveCalls, 1);
    assert.equal(harnessMeasurements.length, 2);
    assert.equal(harness.simulator.getState().running, false);
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
        find: () => {
          throw new Error("database unavailable");
        },
      },
    });
    assert.equal(await failedStartup.simulator.start(), false);
    assert.equal(failedStartup.simulator.getState().running, false);
    assert.equal(failedStartup.errors.length, 1);
  });

  test("failed startup clears a timer and does not retain run state", async () => {
    let infoCalls = 0;
    const failedAfterTimer = simulatorHarness({
      logger: {
        info() {
          infoCalls += 1;
          if (infoCalls === 2) throw new Error("startup log failure");
        },
        warn() {},
        error() {},
      },
    });

    assert.equal(await failedAfterTimer.simulator.start(), false);
    assert.equal(failedAfterTimer.intervalCalls.length, 1);
    assert.deepEqual(failedAfterTimer.clearedIntervals, [
      failedAfterTimer.intervalCalls[0],
    ]);
    assert.deepEqual(failedAfterTimer.simulator.getState(), {
      lifecycle: "stopped",
      running: false,
      deviceCount: 0,
      scenario: null,
      tickNumber: 0,
      failureCount: 0,
      lastError: null,
      lastBatch: null,
    });
  });

  test("stop during startup prevents measurements and interval creation", async () => {
    let completeLocationRead;
    let locationReadStarted;
    const locationRead = new Promise((resolve) => {
      completeLocationRead = resolve;
    });
    const started = new Promise((resolve) => {
      locationReadStarted = resolve;
    });
    const harness = simulatorHarness({
      LocationModel: {
        find: () => ({
          select() {
            return this;
          },
          sort() {
            return this;
          },
          lean() {
            locationReadStarted();
            return locationRead;
          },
        }),
      },
    });

    const starting = harness.simulator.start();
    await started;
    const stopping = harness.simulator.stop();
    completeLocationRead(harness.locations.slice(0, 1));
    assert.equal(await starting, false);
    await stopping;
    assert.equal(harness.measurements.length, 0);
    assert.equal(harness.intervalCalls.length, 0);
    assert.equal(harness.simulator.getState().scenario, null);
    assert.equal(harness.simulator.getState().lifecycle, "stopped");
  });

  test("stop is safe when called before startup", async () => {
    const harness = simulatorHarness();
    await harness.simulator.stop();
    assert.equal(harness.simulator.getState().running, false);
    assert.equal(harness.clearedIntervals.length, 0);
    assert.equal(harness.simulator.getState().scenario, null);
    assert.equal(harness.simulator.getState().failureCount, 0);
    assert.equal(harness.simulator.getState().lastError, null);
  });
});
