const { randomUUID } = require("node:crypto");
const mongoose = require("mongoose");
const TrafficLocation = require("../models/TrafficLocation");
const MonitoringDevice = require("../models/MonitoringDevice");
const {
  validateConfiguredTestDatabaseEnvironment,
} = require("../scripts/seed-test-data");
const trafficMeasurementIngestionService = require("./trafficMeasurementIngestionService");

const DEFAULT_PATTERNS = ["normal", "moderate", "heavy", "burst"];
const ALLOWED_PATTERNS = new Set(DEFAULT_PATTERNS);
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
    return { enabled: false, reason: "The traffic simulator is disabled in production." };
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

  const patterns = environment.STM_TRAFFIC_SIMULATOR_PATTERNS
    ? environment.STM_TRAFFIC_SIMULATOR_PATTERNS
        .split(",")
        .map((pattern) => pattern.trim().toLowerCase())
    : DEFAULT_PATTERNS;
  if (
    patterns.length === 0 ||
    patterns.some((pattern) => !ALLOWED_PATTERNS.has(pattern))
  ) {
    throw createConfigurationError(
      `STM_TRAFFIC_SIMULATOR_PATTERNS may contain only: ${DEFAULT_PATTERNS.join(", ")}.`
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
    patterns,
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
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function generateMeasurement({ device, pattern, random, measuredAt = new Date() }) {
  let vehicleCount;
  let averageSpeed;
  let trafficDensity;

  switch (pattern) {
    case "normal":
      vehicleCount = randomInteger(random, 5, 32);
      averageSpeed = randomInteger(random, 38, 58);
      trafficDensity = "LOW";
      break;
    case "moderate":
      vehicleCount = randomInteger(random, 40, 65);
      averageSpeed = randomInteger(random, 25, 34);
      trafficDensity = "MEDIUM";
      break;
    case "heavy":
      vehicleCount = randomInteger(random, 70, 95);
      averageSpeed = randomInteger(random, 18, 24);
      trafficDensity = "HIGH";
      break;
    case "burst":
      vehicleCount = randomInteger(random, 100, 160);
      averageSpeed = randomInteger(random, 8, 20);
      trafficDensity = "SEVERE";
      break;
    default:
      throw createConfigurationError(`Unsupported simulator pattern: ${pattern}`);
  }

  return {
    device: device._id,
    location: device.location,
    vehicleCount,
    averageSpeed,
    trafficDensity,
    source: "SIMULATOR",
    measuredAt,
  };
}

function createTrafficSimulator({
  environment = process.env,
  LocationModel = TrafficLocation,
  DeviceModel = MonitoringDevice,
  recordMeasurement =
    trafficMeasurementIngestionService.recordTrafficMeasurement,
  logger = console,
  setIntervalFunction = setInterval,
  clearIntervalFunction = clearInterval,
  createRunId = () => randomUUID().replaceAll("-", "").slice(0, 10),
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

  async function runTick() {
    if (lifecycle !== "running" || tickPromise) return;

    tickPromise = (async () => {
      const summary = {
        generated: 0,
        congestionDetected: 0,
        alerts: 0,
        failed: 0,
        patterns: {},
      };
      for (const [index, device] of devices.entries()) {
        if (stopRequested) break;

        const pattern =
          runConfiguration.patterns[
            (tickNumber + index) % runConfiguration.patterns.length
          ];
        summary.patterns[pattern] = (summary.patterns[pattern] || 0) + 1;
        const measurement = generateMeasurement({
          device,
          pattern,
          random,
          measuredAt: now(),
        });

        try {
          const result = await recordMeasurement(measurement);
          summary.generated += 1;
          if (result.processing?.congestionDetected) {
            summary.congestionDetected += 1;
          }
          if (result.processing?.alertCreated) summary.alerts += 1;
          if (result.processing?.completed === false) summary.failed += 1;
        } catch (error) {
          summary.failed += 1;
          logger.error(
            `Traffic simulator failed to record a measurement for ${device.deviceId}:`,
            error
          );
        }
      }
      tickNumber += 1;
      if (summary.generated > 0 || summary.failed > 0) {
        logger.info(
          `[SIMULATOR] batch ${tickNumber}: generated=${summary.generated}, patterns=${JSON.stringify(summary.patterns)}, congestion=${summary.congestionDetected}, alerts=${summary.alerts}, incomplete=${summary.failed}`
        );
      }
    })();

    try {
      await tickPromise;
    } finally {
      tickPromise = null;
    }
  }

  async function createSimulatorDevices(configuration) {
    const runId = createRunId();
    const createdDevices = [];
    for (let index = 0; index < configuration.deviceCount; index += 1) {
      const suffix = String(index + 1).padStart(2, "0");
      const location = await LocationModel.create({
        name: `STM Simulator ${runId} Location ${suffix}`,
        area: "Development simulator data",
        latitude: 12.9 + index * 0.001,
        longitude: 77.5 + index * 0.001,
        status: "ACTIVE",
      });
      const device = await DeviceModel.create({
        deviceId: `STM-SIM-${runId}-${suffix}`,
        deviceType: "TRAFFIC_SENSOR",
        name: `[SIMULATOR] ${runId} traffic sensor ${suffix}`,
        location: location._id,
        status: "ACTIVE",
      });
      createdDevices.push(device);
    }
    return createdDevices;
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
        random = createSeededRandom(configuration.seed);
        devices = await createSimulatorDevices(configuration);
        if (stopRequested) {
          lifecycle = "stopped";
          devices = [];
          return false;
        }

        lifecycle = "running";
        await runTick();
        if (stopRequested) {
          lifecycle = "stopped";
          devices = [];
          return false;
        }
        intervalHandle = setIntervalFunction(
          () => {
            void runTick().catch((error) =>
              logger.error("Traffic simulator tick failed:", error)
            );
          },
          configuration.intervalMs
        );
        logger.info(
          `[SIMULATOR] started with ${devices.length} simulator-owned device(s), interval=${configuration.intervalMs}ms, patterns=${configuration.patterns.join(",")}. Data is simulated, not live traffic.`
        );
        return true;
      } catch (error) {
        lifecycle = "stopped";
        devices = [];
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
    devices = [];
    random = null;
    runConfiguration = null;
    tickNumber = 0;
  }

  return {
    start,
    stop,
    runTick,
    getState: () => ({
      lifecycle,
      running: lifecycle === "running",
      deviceCount: devices.length,
    }),
  };
}

const trafficSimulator = createTrafficSimulator();

module.exports = {
  ALLOWED_PATTERNS,
  createSeededRandom,
  createTrafficSimulator,
  generateMeasurement,
  parseSimulatorConfiguration,
  trafficSimulator,
};
