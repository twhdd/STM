require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../models/User");
const TrafficLocation = require("../models/TrafficLocation");
const TrafficSignal = require("../models/TrafficSignal");
const MonitoringDevice = require("../models/MonitoringDevice");
const TrafficMeasurement = require("../models/TrafficMeasurement");
const CongestionEvent = require("../models/CongestionEvent");
const Route = require("../models/Route");
const TrafficAlert = require("../models/TrafficAlert");
const EmergencyVehicle = require("../models/EmergencyVehicle");
const CitizenReport = require("../models/CitizenReport");

const TEST_DATABASE_NAME = "stm_test";
const TEST_ACCOUNTS = [
  ["stm.admin.test@example.com", "ADMIN"],
  ["stm.authority.test@example.com", "TRAFFIC_AUTHORITY"],
  ["stm.police.test@example.com", "TRAFFIC_POLICE"],
  ["stm.emergency.test@example.com", "EMERGENCY_SERVICE"],
  ["stm.citizen.test@example.com", "CITIZEN"],
];

const LOCATIONS = [
  {
    key: "central",
    name: "Central Market Junction (STM test)",
    area: "Central District",
    latitude: 12.9754,
    longitude: 77.6051,
  },
  {
    key: "riverside",
    name: "Riverside Bridge (STM test)",
    area: "Riverside",
    latitude: 12.9812,
    longitude: 77.6126,
  },
  {
    key: "university",
    name: "University Circle (STM test)",
    area: "Education Quarter",
    latitude: 12.9347,
    longitude: 77.6058,
  },
  {
    key: "airport",
    name: "Airport Corridor Gate (STM test)",
    area: "North Corridor",
    latitude: 13.0198,
    longitude: 77.6341,
  },
];

const DEVICE_DEFINITIONS = [
  { key: "sensor-central", deviceId: "STM-TEST-SENSOR-001", deviceType: "TRAFFIC_SENSOR", name: "Central Market traffic sensor", location: "central" },
  { key: "sensor-riverside", deviceId: "STM-TEST-SENSOR-002", deviceType: "TRAFFIC_SENSOR", name: "Riverside Bridge traffic sensor", location: "riverside" },
  { key: "sensor-university", deviceId: "STM-TEST-SENSOR-003", deviceType: "TRAFFIC_SENSOR", name: "University Circle traffic sensor", location: "university" },
  { key: "sensor-airport", deviceId: "STM-TEST-SENSOR-004", deviceType: "TRAFFIC_SENSOR", name: "Airport Corridor traffic sensor", location: "airport" },
  { key: "cctv-central", deviceId: "STM-TEST-CCTV-001", deviceType: "CCTV", name: "Central Market traffic camera", location: "central" },
  { key: "gps-airport", deviceId: "STM-TEST-GPS-001", deviceType: "GPS", name: "Airport Corridor vehicle monitor", location: "airport" },
];

const MEASUREMENT_DEFINITIONS = [
  { device: "sensor-central", location: "central", vehicleCount: 132, averageSpeed: 12, trafficDensity: "SEVERE" },
  { device: "sensor-riverside", location: "riverside", vehicleCount: 82, averageSpeed: 22, trafficDensity: "HIGH" },
  { device: "sensor-university", location: "university", vehicleCount: 52, averageSpeed: 31, trafficDensity: "MEDIUM" },
  { device: "sensor-airport", location: "airport", vehicleCount: 21, averageSpeed: 48, trafficDensity: "LOW" },
];

const SIGNAL_DEFINITIONS = LOCATIONS.map((location, index) => ({
  signalId: `STM-TEST-SIGNAL-${String(index + 1).padStart(3, "0")}`,
  name: `${location.name} signal`,
  location: location.key,
  greenTime: [30, 35, 25, 40][index],
}));

const EMERGENCY_VEHICLES = [
  { vehicleId: "STM-TEST-AMB-001", vehicleType: "AMBULANCE", registrationNumber: "STM-TEST-AMB-001", currentLocation: "central", status: "EN_ROUTE" },
  { vehicleId: "STM-TEST-FIRE-001", vehicleType: "FIRE_TRUCK", registrationNumber: "STM-TEST-FIRE-001", currentLocation: "riverside", status: "AVAILABLE" },
  { vehicleId: "STM-TEST-POLICE-001", vehicleType: "POLICE", registrationNumber: "STM-TEST-POLICE-001", currentLocation: "university", status: "ON_SCENE" },
];

class SeedConfigurationError extends Error {}

function databaseNameFromUri(mongoUri) {
  let parsedUri;
  try {
    parsedUri = new URL(mongoUri);
  } catch {
    throw new SeedConfigurationError("MONGO_URI must be a valid MongoDB connection URI.");
  }

  if (!["mongodb:", "mongodb+srv:"].includes(parsedUri.protocol)) {
    throw new SeedConfigurationError("MONGO_URI must use the mongodb or mongodb+srv protocol.");
  }

  try {
    return decodeURIComponent(parsedUri.pathname.replace(/^\/+/, "").split("/")[0]);
  } catch {
    throw new SeedConfigurationError("MONGO_URI contains an invalid database name.");
  }
}

function validateTestDatabaseName(databaseName) {
  if (
    typeof databaseName !== "string" ||
    !/^[a-zA-Z0-9_-]+$/.test(databaseName) ||
    !/(^|[_-])test([_-]|$)/i.test(databaseName) ||
    /(^|[_-])(prod|production|live|staging)([_-]|$)/i.test(databaseName)
  ) {
    throw new SeedConfigurationError(
      "STM_TEST_DATABASE_NAME must be a safe test database name and must not identify a production, live, or staging database."
    );
  }
  return databaseName;
}

function assertConnectedDatabaseName(connectedDatabaseName, expectedDatabaseName) {
  if (connectedDatabaseName !== expectedDatabaseName) {
    throw new SeedConfigurationError(
      `Connected database name does not match the guarded test database ${expectedDatabaseName}.`
    );
  }
}

function validateTargetDatabase(environment, databaseName) {
  if (!environment.MONGO_URI) {
    throw new SeedConfigurationError("MONGO_URI must point to the configured test MongoDB cluster.");
  }

  const uriDatabaseName = databaseNameFromUri(environment.MONGO_URI);
  if (uriDatabaseName && uriDatabaseName !== databaseName) {
    throw new SeedConfigurationError(
      `The database name in MONGO_URI must be ${databaseName} when present.`
    );
  }

  return {
    mongoUri: environment.MONGO_URI,
    databaseName,
  };
}

function validateEnvironment(environment) {
  if (environment.NODE_ENV !== "development") {
    throw new SeedConfigurationError("Set NODE_ENV=development to seed test data.");
  }
  if (environment.STM_TEST_DATA_CONFIRM !== "YES") {
    throw new SeedConfigurationError(
      "Set STM_TEST_DATA_CONFIRM=YES to explicitly confirm test-data seeding."
    );
  }
  if (environment.STM_TEST_DATABASE_NAME !== TEST_DATABASE_NAME) {
    throw new SeedConfigurationError(
      `STM_TEST_DATABASE_NAME must be exactly ${TEST_DATABASE_NAME}.`
    );
  }
  return validateTargetDatabase(environment, TEST_DATABASE_NAME);
}

function validateConfiguredTestDatabaseEnvironment(environment) {
  if (environment.NODE_ENV !== "development") {
    throw new SeedConfigurationError(
      "Set NODE_ENV=development to use a configured test database."
    );
  }
  if (environment.STM_TEST_DATA_CONFIRM !== "YES") {
    throw new SeedConfigurationError(
      "Set STM_TEST_DATA_CONFIRM=YES to explicitly confirm test-database writes."
    );
  }
  const databaseName = validateTestDatabaseName(
    environment.STM_TEST_DATABASE_NAME
  );
  return validateTargetDatabase(environment, databaseName);
}

function validateIntegrationEnvironment(environment) {
  if (environment.STM_RUN_TRAFFIC_PROCESSING_INTEGRATION !== "YES") {
    throw new SeedConfigurationError(
      "Set STM_RUN_TRAFFIC_PROCESSING_INTEGRATION=YES to explicitly opt in to MongoDB integration tests."
    );
  }
  return validateConfiguredTestDatabaseEnvironment(environment);
}

function upsertSeedRecord(Model, filter, fields, insertOnlyFields = {}) {
  return Model.findOneAndUpdate(
    filter,
    {
      $set: fields,
      $setOnInsert: insertOnlyFields,
    },
    {
      upsert: true,
      returnDocument: "after",
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  );
}

async function verifyTestAccounts() {
  const users = await Promise.all(
    TEST_ACCOUNTS.map(async ([email, role]) => ({
      email,
      role,
      user: await User.findOne({ email }),
    }))
  );
  const missingOrConflicting = users
    .filter(({ user, role }) => !user || user.role !== role)
    .map(({ email, role, user }) => `${email} (expected ${role}, found ${user?.role || "missing"})`);

  if (missingOrConflicting.length) {
    throw new Error(
      `Expected test accounts are missing or have role conflicts: ${missingOrConflicting.join("; ")}`
    );
  }

  return new Map(users.map(({ email, user }) => [email, user]));
}

async function seedTrafficData() {
  const users = await verifyTestAccounts();
  const locations = new Map();
  for (const location of LOCATIONS) {
    const saved = await upsertSeedRecord(
      TrafficLocation,
      { name: location.name, area: location.area },
      {
        latitude: location.latitude,
        longitude: location.longitude,
        status: "ACTIVE",
      }
    );
    locations.set(location.key, saved);
  }

  const signals = new Map();
  for (const signal of SIGNAL_DEFINITIONS) {
    const location = locations.get(signal.location);
    const saved = await upsertSeedRecord(
      TrafficSignal,
      { signalId: signal.signalId },
      { name: signal.name, location: location._id },
      {
        status: "ACTIVE",
        currentPhase: "NORTH_SOUTH",
        greenTime: signal.greenTime,
        yellowTime: 5,
        redTime: 30,
      }
    );
    signals.set(signal.location, saved);
  }

  const devices = new Map();
  for (const device of DEVICE_DEFINITIONS) {
    const location = locations.get(device.location);
    const saved = await upsertSeedRecord(
      MonitoringDevice,
      { deviceId: device.deviceId },
      {
        deviceType: device.deviceType,
        name: device.name,
        location: location._id,
      },
      { status: "ACTIVE", lastActiveAt: new Date() }
    );
    devices.set(device.key, saved);
  }

  const measurements = new Map();
  for (const [index, measurement] of MEASUREMENT_DEFINITIONS.entries()) {
    const device = devices.get(measurement.device);
    const location = locations.get(measurement.location);
    const saved = await upsertSeedRecord(
      TrafficMeasurement,
      { device: device._id, location: location._id },
      {
        vehicleCount: measurement.vehicleCount,
        averageSpeed: measurement.averageSpeed,
        trafficDensity: measurement.trafficDensity,
        measuredAt: new Date(Date.now() - index * 60_000),
      }
    );
    measurements.set(measurement.location, saved);
  }

  const events = new Map();
  for (const locationKey of ["central", "riverside"]) {
    const measurement = measurements.get(locationKey);
    const location = locations.get(locationKey);
    const definition = MEASUREMENT_DEFINITIONS.find((item) => item.location === locationKey);
    const description = `STM test seed: ${locationKey} congestion event`;
    const saved = await upsertSeedRecord(
      CongestionEvent,
      { measurement: measurement._id, description },
      {
        location: location._id,
        congestionLevel: definition.trafficDensity,
        vehicleCount: definition.vehicleCount,
        averageSpeed: definition.averageSpeed,
      },
      { status: "ACTIVE", detectedAt: new Date() }
    );
    events.set(locationKey, saved);

    const existingAlert = await TrafficAlert.findOne({ congestionEvent: saved._id });
    if (!existingAlert) {
      await TrafficAlert.create({
        alertType: "CONGESTION",
        location: location._id,
        congestionEvent: saved._id,
        message: `${definition.trafficDensity} congestion reported at ${location.name}`,
        severity: definition.trafficDensity === "SEVERE" ? "CRITICAL" : "WARNING",
        status: "ACTIVE",
      });
    }
  }

  const routeDefinitions = [];
  let routeNumber = 1;
  for (const start of LOCATIONS) {
    for (const end of LOCATIONS) {
      if (start.key === end.key) continue;
      const index = LOCATIONS.indexOf(end);
      routeDefinitions.push({
        routeId: `STM-TEST-ROUTE-${String(routeNumber).padStart(3, "0")}`,
        name: `${start.name} to ${end.name}`,
        startLocation: start.key,
        endLocation: end.key,
        distance: Number((3.2 + Math.abs(LOCATIONS.indexOf(start) - index) * 1.8).toFixed(1)),
        estimatedTime: 8 + Math.abs(LOCATIONS.indexOf(start) - index) * 5,
        status: routeNumber % 5 === 0 ? "CONGESTED" : "AVAILABLE",
        trafficLevel: ["LOW", "MEDIUM", "HIGH", "SEVERE"][routeNumber % 4],
      });
      routeNumber += 1;
    }
  }
  routeDefinitions.push({
    routeId: "STM-TEST-ROUTE-013",
    name: "Central Market to University Circle via South Avenue",
    startLocation: "central",
    endLocation: "university",
    distance: 6.4,
    estimatedTime: 17,
    status: "AVAILABLE",
    trafficLevel: "LOW",
  });

  for (const route of routeDefinitions) {
    await upsertSeedRecord(
      Route,
      { routeId: route.routeId },
      {
        name: route.name,
        startLocation: locations.get(route.startLocation)._id,
        endLocation: locations.get(route.endLocation)._id,
        distance: route.distance,
        estimatedTime: route.estimatedTime,
        status: route.status,
        trafficLevel: route.trafficLevel,
      }
    );
  }

  for (const vehicle of EMERGENCY_VEHICLES) {
    await upsertSeedRecord(
      EmergencyVehicle,
      { vehicleId: vehicle.vehicleId },
      {
        vehicleType: vehicle.vehicleType,
        registrationNumber: vehicle.registrationNumber,
        currentLocation: locations.get(vehicle.currentLocation)._id,
      },
      {
        status: vehicle.status,
        priorityActive: false,
      }
    );
  }

  const citizen = users.get("stm.citizen.test@example.com");
  const reviewer = users.get("stm.authority.test@example.com");
  const seededReports = [
    {
      location: locations.get("university"),
      reportType: "ROAD_BLOCKAGE",
      description: "STM test seed: road obstruction near University Circle",
      severity: "HIGH",
      status: "SUBMITTED",
    },
    {
      location: locations.get("airport"),
      reportType: "SIGNAL_ISSUE",
      description: "STM test seed: signal timing concern at Airport Corridor Gate",
      severity: "MEDIUM",
      status: "UNDER_REVIEW",
      reviewedBy: reviewer._id,
      reviewedAt: new Date(),
    },
  ];

  for (const report of seededReports) {
    const { location } = report;
    const insertOnlyFields = {
      status: report.status,
      ...(report.reviewedBy
        ? { reviewedBy: report.reviewedBy, reviewedAt: report.reviewedAt }
        : {}),
    };
    await upsertSeedRecord(
      CitizenReport,
      {
        reportedBy: citizen._id,
        location: location._id,
        description: report.description,
      },
      {
        reportedBy: citizen._id,
        location: location._id,
        reportType: report.reportType,
        description: report.description,
        severity: report.severity,
      },
      insertOnlyFields
    );
  }

  return {
    locations: locations.size,
    signals: signals.size,
    devices: devices.size,
    measurements: measurements.size,
    congestionEvents: events.size,
    routes: routeDefinitions.length,
    emergencyVehicles: EMERGENCY_VEHICLES.length,
    alerts: events.size,
    citizenReports: seededReports.length,
  };
}

async function run() {
  const configuration = validateEnvironment(process.env);
  let connected = false;
  try {
    await mongoose.connect(configuration.mongoUri, { dbName: configuration.databaseName });
    connected = true;
    const counts = await seedTrafficData();
    console.log(`Seeded STM test data in ${TEST_DATABASE_NAME}: ${JSON.stringify(counts)}`);
  } finally {
    if (connected) await mongoose.disconnect();
  }
}

if (require.main === module) {
  run().catch((error) => {
    if (error instanceof SeedConfigurationError || error.message.startsWith("Expected test accounts")) {
      console.error(error.message);
    } else {
      console.error("STM test-data seeding failed. No application database was selected by default.");
    }
    process.exitCode = 1;
  });
}

module.exports = {
  assertConnectedDatabaseName,
  databaseNameFromUri,
  seedTrafficData,
  upsertSeedRecord,
  validateConfiguredTestDatabaseEnvironment,
  validateIntegrationEnvironment,
  validateTestDatabaseName,
  validateEnvironment,
};
