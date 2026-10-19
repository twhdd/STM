const mongoose = require("mongoose");
const TrafficLocation = require("../models/TrafficLocation");
const MonitoringDevice = require("../models/MonitoringDevice");
const {
  validateConfiguredTestDatabaseEnvironment,
} = require("../scripts/seed-test-data");
const { determineCongestionLevel } = require("./congestionDetectionService");
const trafficMeasurementIngestionService = require("./trafficMeasurementIngestionService");

const SCENARIO_PROFILES = Object.freeze({
  normal: {
    initial: { vehicleCount: 20, averageSpeed: 48 },
    target: { vehicleCount: 20, averageSpeed: 48 },
    step: { vehicleCount: 0, averageSpeed: 0 },
  },
  "rush-hour": {
    initial: { vehicleCount: 20, averageSpeed: 48 },
    target: { vehicleCount: 82, averageSpeed: 20 },
    step: { vehicleCount: 8, averageSpeed: 4 },
  },
  "heavy-congestion": {
    initial: { vehicleCount: 32, averageSpeed: 42 },
    target: { vehicleCount: 92, averageSpeed: 18 },
    step: { vehicleCount: 10, averageSpeed: 4 },
  },
  incident: {
    initial: { vehicleCount: 25, averageSpeed: 48 },
    target: { vehicleCount: 125, averageSpeed: 9 },
    step: { vehicleCount: 20, averageSpeed: 7 },
  },
  recovery: {
    initial: { vehicleCount: 115, averageSpeed: 12 },
    target: { vehicleCount: 20, averageSpeed: 48 },
    step: { vehicleCount: 12, averageSpeed: 5 },
  },
});
const ALLOWED_SCENARIOS = new Set(Object.keys(SCENARIO_PROFILES));
const DEFAULT_INTERVAL_MS = 15000;
const DEFAULT_DEVICE_COUNT = 3;
const MAX_DEVICE_COUNT = 20;

function createConfigurationError(message) {
  const error = new Error(message);
  error.name = "SimulatorConfigurationError";
  return error;
}

function parseSimulatorConfiguration(environment) {
  if (environment.NODE_ENV === "production") {
    return {
      enabled: false,
      reason: "The traffic simulator is disabled in production.",
    };
  }

  if (
    environment.NODE_ENV !== "development" ||
    environment.STM_TRAFFIC_SIMULATOR_ENABLED !== "YES"
  ) {
    return {
      enabled: false,
      reason: "The traffic simulator requires development mode and explicit opt-in.",
    };
  }

  const intervalMs = environment.STM_TRAFFIC_SIMULATOR_INTERVAL_MS
    ? Number(environment.STM_TRAFFIC_SIMULATOR_INTERVAL_MS)
    : DEFAULT_INTERVAL_MS;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1000) {
    throw createConfigurationError(
      "STM_TRAFFIC_SIMULATOR_INTERVAL_MS must be an integer of at least 1000."
    );
  }

  const deviceCount = environment.STM_TRAFFIC_SIMULATOR_DEVICE_COUNT
    ? Number(environment.STM_TRAFFIC_SIMULATOR_DEVICE_COUNT)
    : DEFAULT_DEVICE_COUNT;
  if (
    !Number.isSafeInteger(deviceCount) ||
    deviceCount < 1 ||
    deviceCount > MAX_DEVICE_COUNT
  ) {
    throw createConfigurationError(
      `STM_TRAFFIC_SIMULATOR_DEVICE_COUNT must be an integer between 1 and ${MAX_DEVICE_COUNT}.`
    );
  }

  const scenario = environment.STM_TRAFFIC_SIMULATOR_SCENARIO || "normal";
  if (!ALLOWED_SCENARIOS.has(scenario)) {
    throw createConfigurationError(
      "STM_TRAFFIC_SIMULATOR_SCENARIO must be one of: " +
        `${[...ALLOWED_SCENARIOS].join(", ")}.`
    );
  }

  let seed;
  if (environment.STM_TRAFFIC_SIMULATOR_SEED) {
    seed = Number(environment.STM_TRAFFIC_SIMULATOR_SEED);
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw createConfigurationError(
        "STM_TRAFFIC_SIMULATOR_SEED must be an integer between 0 and 4294967295."
      );
    }
  }

  return {
    enabled: true,
    intervalMs,
    deviceCount,
    scenario,
    seed,
  };
}

function createSeededRandom(seed) {
  if (seed === undefined) return Math.random;

  let state = seed >>> 0;
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function randomInteger(random, minimum, maximum) {
  const sample = random();
  if (
    typeof sample !== "number" ||
    !Number.isFinite(sample) ||
    sample < 0 ||
    sample >= 1
  ) {
    throw createConfigurationError(
      "The simulator random source must return a number in the range [0, 1)."
    );
  }
  return minimum + Math.floor(sample * (maximum - minimum + 1));
}

function createScenarioState(scenario, random) {
  const profile = SCENARIO_PROFILES[scenario];
  if (!profile) {
    throw createConfigurationError(`Unsupported traffic scenario: ${scenario}`);
  }
  const vehicleOffset = randomInteger(random, -3, 3);
  const speedOffset = randomInteger(random, -2, 2);
  return {
    vehicleCount: Math.max(0, profile.initial.vehicleCount + vehicleOffset),
    averageSpeed: Math.max(0, profile.initial.averageSpeed + speedOffset),
    targetVehicleCount: Math.max(
      0,
      profile.target.vehicleCount + vehicleOffset
    ),
    targetAverageSpeed: Math.max(
      0,
      profile.target.averageSpeed + speedOffset
    ),
    vehicleStep: profile.step.vehicleCount,
    speedStep: profile.step.averageSpeed,
  };
}

function moveToward(value, target, maximumStep) {
  if (value < target) return Math.min(target, value + maximumStep);
  if (value > target) return Math.max(target, value - maximumStep);
  return value;
}

function advanceScenarioState(state) {
  state.vehicleCount = moveToward(
    state.vehicleCount,
    state.targetVehicleCount,
    state.vehicleStep
  );
  state.averageSpeed = moveToward(
    state.averageSpeed,
    state.targetAverageSpeed,
    state.speedStep
  );
  return state;
}

function generateMeasurement({ device, state, measuredAt = new Date() }) {
  return {
    device: device._id,
    location: device.location,
    vehicleCount: state.vehicleCount,
    averageSpeed: state.averageSpeed,
    trafficDensity: determineCongestionLevel(
      state.vehicleCount,
      state.averageSpeed
    ),
    source: "SIMULATOR",
    measuredAt,
  };
}

async function findConfiguredDevices({
  LocationModel,
  DeviceModel,
  deviceCount,
}) {
  const locations = await LocationModel.find({ status: "ACTIVE" })
    .select("_id")
    .sort({ _id: 1 })
    .lean();
  if (!locations.length) return [];

  const locationIds = locations.map(({ _id }) => _id);
  const activeLocationIds = new Set(locationIds.map(String));
  const devices = await DeviceModel.find({
    status: "ACTIVE",
    deviceType: "TRAFFIC_SENSOR",
    location: { $in: locationIds },
  })
    .sort({ deviceId: 1, _id: 1 })
    .limit(deviceCount)
    .lean();

  return devices.filter(
    (device) =>
      device.location && activeLocationIds.has(String(device.location))
  );
}

function createTrafficSimulator({
  environment = process.env,
  LocationModel = TrafficLocation,
  DeviceModel = MonitoringDevice,
  recordMeasurement =
    trafficMeasurementIngestionService.recordTrafficMeasurement,
  randomSource,
  logger = console,
  setIntervalFunction = setInterval,
  clearIntervalFunction = clearInterval,
  now = () => new Date(),
  getDatabaseName = () => mongoose.connection.name,
} = {}) {
  let lifecycle = "stopped";
  let startPromise = null;
  let intervalHandle = null;
  let tickPromise = null;
  let stopRequested = false;
  let runConfiguration = null;
  let random = null;
  let tickNumber = 0;
  let devices = [];
  let scenarioStates = new Map();
  let failureCount = 0;
  let lastError = null;
  let lastBatch = null;

  function clearRunState() {
    devices = [];
    scenarioStates.clear();
    random = null;
    runConfiguration = null;
    tickNumber = 0;
    failureCount = 0;
    lastError = null;
    lastBatch = null;
  }

  async function runTick() {
    if (lifecycle !== "running") return;
    if (tickPromise) return tickPromise;

    const currentTick = Promise.resolve().then(async () => {
      const summary = {
        tick: tickNumber + 1,
        scenario: runConfiguration.scenario,
        generated: 0,
        congestionDetected: 0,
        alerts: 0,
        failed: 0,
      };
      for (const device of devices) {
        if (stopRequested) break;

        const state = scenarioStates.get(String(device._id));
        advanceScenarioState(state);
        const measurement = generateMeasurement({
          device,
          state,
          measuredAt: now(),
        });

        try {
          const result = await recordMeasurement(measurement);
          summary.generated += 1;
          if (result.processing?.congestionDetected) {
            summary.congestionDetected += 1;
          }
          if (result.processing?.alertCreated) summary.alerts += 1;
          if (result.processing?.completed === false) {
            summary.failed += 1;
            lastError =
              result.processing.message ||
              "Traffic measurement processing did not complete";
          }
        } catch (error) {
          summary.failed += 1;
          lastError = String(error?.message || error);
          logger.error(
            `Traffic simulator failed to record a measurement for ${device.deviceId}:`,
            error
          );
        }
      }
      tickNumber += 1;
      failureCount += summary.failed;
      lastBatch = summary;
      if (summary.generated > 0 || summary.failed > 0) {
        logger.info(
          `[SIMULATOR] tick ${tickNumber}: scenario=${summary.scenario}, generated=${summary.generated}, congestion=${summary.congestionDetected}, alerts=${summary.alerts}, incomplete=${summary.failed}`
        );
      }
      return summary;
    });

    tickPromise = currentTick;
    try {
      return await currentTick;
    } finally {
      if (tickPromise === currentTick) tickPromise = null;
    }
  }

  async function start() {
    if (lifecycle === "running") return true;
    if (startPromise) return startPromise;

    let configuration;
    try {
      configuration = parseSimulatorConfiguration(environment);
    } catch (error) {
      logger.error("Traffic simulator configuration is invalid:", error);
      return false;
    }
    if (!configuration.enabled) {
      if (environment.STM_TRAFFIC_SIMULATOR_ENABLED === "YES") {
        logger.warn(configuration.reason);
      }
      return false;
    }
    let testDatabase;
    try {
      testDatabase =
        validateConfiguredTestDatabaseEnvironment(environment).databaseName;
    } catch (error) {
      logger.error(
        "Traffic simulator refused an unsafe database configuration:",
        error
      );
      return false;
    }
    if (getDatabaseName() !== testDatabase) {
      logger.error(
        `Traffic simulator refused to write because the connected database does not match ${testDatabase}.`
      );
      return false;
    }

    lifecycle = "starting";
    stopRequested = false;
    startPromise = (async () => {
      try {
        runConfiguration = configuration;
        random = randomSource || createSeededRandom(configuration.seed);
        failureCount = 0;
        lastError = null;
        lastBatch = null;
        tickNumber = 0;
        devices = await findConfiguredDevices({
          LocationModel,
          DeviceModel,
          deviceCount: configuration.deviceCount,
        });
        if (!devices.length) {
          logger.warn(
            "Traffic simulator found no active traffic sensors at active locations; no measurements were generated."
          );
          lifecycle = "stopped";
          clearRunState();
          return false;
        }
        scenarioStates = new Map(
          devices.map((device) => [
            String(device._id),
            createScenarioState(configuration.scenario, random),
          ])
        );
        if (stopRequested) {
          lifecycle = "stopped";
          clearRunState();
          return false;
        }

        lifecycle = "running";
        await runTick();
        if (stopRequested) {
          lifecycle = "stopped";
          clearRunState();
          return false;
        }
        intervalHandle = setIntervalFunction(
          () => {
            void runTick().catch((error) => {
              failureCount += 1;
              lastError = String(error?.message || error);
              logger.error("Traffic simulator tick failed:", error);
            });
          },
          configuration.intervalMs
        );
        logger.info(
          `[SIMULATOR] started with ${devices.length} configured traffic sensor(s), interval=${configuration.intervalMs}ms, scenario=${configuration.scenario}. Data is simulated, not live traffic.`
        );
        return true;
      } catch (error) {
        if (intervalHandle !== null) {
          clearIntervalFunction(intervalHandle);
          intervalHandle = null;
        }
        lifecycle = "stopped";
        clearRunState();
        logger.error("Traffic simulator failed to start:", error);
        return false;
      } finally {
        startPromise = null;
      }
    })();

    return startPromise;
  }

  async function stop() {
    stopRequested = true;
    if (startPromise) await startPromise;

    if (intervalHandle !== null) {
      clearIntervalFunction(intervalHandle);
      intervalHandle = null;
    }
    if (tickPromise) await tickPromise;

    lifecycle = "stopped";
    clearRunState();
    stopRequested = false;
  }

  return {
    start,
    stop,
    runTick,
    getState: () => ({
      lifecycle,
      running: lifecycle === "running",
      deviceCount: devices.length,
      scenario: runConfiguration?.scenario || null,
      tickNumber,
      failureCount,
      lastError,
      lastBatch,
    }),
  };
}

const trafficSimulator = createTrafficSimulator();

module.exports = {
  ALLOWED_SCENARIOS,
  createSeededRandom,
  createScenarioState,
  createTrafficSimulator,
  advanceScenarioState,
  generateMeasurement,
  parseSimulatorConfiguration,
  trafficSimulator,
};
