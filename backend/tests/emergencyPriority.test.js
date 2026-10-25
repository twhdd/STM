// Emergency-priority lifecycle tests. Run: npm test (from backend/)
// No database needed: model methods are stubbed, requests go through the real Express app.
process.env.JWT_SECRET = "test-secret-for-emergency-priority-tests";

const { test, describe, before, after, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

mongoose.set("bufferCommands", false);

const app = require("../server");
const EmergencyVehicle = require("../models/EmergencyVehicle");
const TrafficSignal = require("../models/TrafficSignal");
const TrafficMeasurement = require("../models/TrafficMeasurement");

const oid = () => new mongoose.Types.ObjectId();
const LOCATION = oid();

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

afterEach(() => mock.restoreAll());

async function post(path, body, role = "EMERGENCY_SERVICE") {
  const token = jwt.sign({ userId: oid().toString(), role }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
  const res = await fetch(baseUrl + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: json, text };
}

const vehicleDoc = (overrides = {}) => ({
  _id: oid(),
  vehicleId: "AMB-1",
  vehicleType: "AMBULANCE",
  status: "EN_ROUTE",
  currentLocation: LOCATION,
  priorityActive: false,
  ...overrides,
});

const signalDoc = (overrides = {}) => ({
  _id: oid(),
  signalId: "SIG-1",
  name: "Main & 1st",
  status: "ACTIVE",
  currentPhase: "EAST_WEST",
  greenTime: 35,
  location: LOCATION,
  ...overrides,
});

// Replace a model method; returns the recorded call arguments.
function stub(Model, name, impl) {
  const calls = [];
  mock.method(Model, name, async (...args) => {
    calls.push(args);
    return impl(...args);
  });
  return calls;
}

const WRITE_OK = { matchedCount: 1, modifiedCount: 1 };
const WRITE_MISS = { matchedCount: 0, modifiedCount: 0 };

describe("TrafficSignal schema", () => {
  test("priorityOverride is an optional embedded state with the previous phase and green time", () => {
    const path = TrafficSignal.schema.path("priorityOverride");
    assert.ok(path, "priorityOverride must exist on TrafficSignal");
    for (const field of ["vehicle", "previousPhase", "previousGreenTime", "activatedAt"]) {
      assert.ok(path.schema.path(field), `priorityOverride.${field}`);
    }
    const signal = new TrafficSignal({ signalId: "S", name: "n", location: LOCATION });
    assert.equal(signal.priorityOverride, undefined);
  });

  test("the legacy fallback green time is the schema default of 30 seconds", () => {
    assert.equal(TrafficSignal.schema.path("greenTime").options.default, 30);
  });
});

describe("POST /api/emergency-priority/activate", () => {
  test("saves the previous phase and green time once, guarded against an existing override", async () => {
    const vehicle = vehicleDoc();
    const signal = signalDoc();
    stub(EmergencyVehicle, "findById", () => vehicle);
    stub(TrafficSignal, "findOne", () => signal);
    const signalWrites = stub(TrafficSignal, "findOneAndUpdate", (_f, update) => ({
      ...signal,
      currentPhase: "NORTH_SOUTH",
      greenTime: 60,
      priorityOverride: update.$set.priorityOverride,
    }));
    const vehicleWrites = stub(EmergencyVehicle, "updateOne", () => WRITE_OK);

    const res = await post("/api/emergency-priority/activate", { vehicleId: vehicle._id.toString() });

    assert.equal(res.status, 200, res.text);
    assert.equal(signalWrites.length, 1);
    const [filter, update] = signalWrites[0];
    assert.deepEqual(filter, {
      _id: signal._id,
      status: "ACTIVE",
      currentPhase: "EAST_WEST",
      greenTime: 35,
      "priorityOverride.vehicle": { $exists: false },
    });
    assert.equal(update.$set.currentPhase, "NORTH_SOUTH");
    assert.equal(update.$set.greenTime, 60);
    const saved = update.$set.priorityOverride;
    assert.equal(String(saved.vehicle), String(vehicle._id));
    assert.equal(saved.previousPhase, "EAST_WEST");
    assert.equal(saved.previousGreenTime, 35);
    assert.ok(saved.activatedAt instanceof Date);

    assert.equal(vehicleWrites.length, 1);
    assert.deepEqual(vehicleWrites[0][0], { _id: vehicle._id, priorityActive: { $ne: true } });
    assert.equal(vehicleWrites[0][1].$set.priorityActive, true);
    assert.ok(vehicleWrites[0][1].$set.activatedAt instanceof Date);

    assert.equal(res.body.vehicle.priorityActive, true);
    assert.equal(res.body.signal.currentPhase, "NORTH_SOUTH");
    assert.equal(res.body.signal.greenTime, 60);
    assert.equal(typeof res.body.message, "string");
  });

  test("a repeated activation is rejected with 409 and writes nothing", async () => {
    const vehicle = vehicleDoc({ priorityActive: true, activatedAt: new Date() });
    stub(EmergencyVehicle, "findById", () => vehicle);
    const findSignal = stub(TrafficSignal, "findOne", () => signalDoc());
    const signalWrites = stub(TrafficSignal, "findOneAndUpdate", () => null);
    const vehicleWrites = stub(EmergencyVehicle, "updateOne", () => WRITE_OK);

    const res = await post("/api/emergency-priority/activate", { vehicleId: vehicle._id.toString() });

    assert.equal(res.status, 409);
    assert.equal(res.body.code, "PRIORITY_ALREADY_ACTIVE");
    assert.equal(findSignal.length + signalWrites.length + vehicleWrites.length, 0);
  });

  test("a signal that already carries another vehicle's override is not overwritten", async () => {
    const vehicle = vehicleDoc();
    const signal = signalDoc({
      currentPhase: "NORTH_SOUTH",
      greenTime: 60,
      priorityOverride: { vehicle: oid(), previousPhase: "EAST_WEST", previousGreenTime: 35, activatedAt: new Date() },
    });
    stub(EmergencyVehicle, "findById", () => vehicle);
    stub(TrafficSignal, "findOne", () => signal);
    const signalWrites = stub(TrafficSignal, "findOneAndUpdate", () => null);
    const vehicleWrites = stub(EmergencyVehicle, "updateOne", () => WRITE_OK);

    const res = await post("/api/emergency-priority/activate", { vehicleId: vehicle._id.toString() });

    assert.equal(res.status, 409);
    assert.equal(res.body.code, "SIGNAL_ALREADY_OVERRIDDEN");
    assert.equal(signalWrites.length + vehicleWrites.length, 0);
  });

  test("a lost compare-and-set on the signal returns 409 without touching the vehicle", async () => {
    const vehicle = vehicleDoc();
    stub(EmergencyVehicle, "findById", () => vehicle);
    stub(TrafficSignal, "findOne", () => signalDoc());
    stub(TrafficSignal, "findOneAndUpdate", () => null);
    const vehicleWrites = stub(EmergencyVehicle, "updateOne", () => WRITE_OK);

    const res = await post("/api/emergency-priority/activate", { vehicleId: vehicle._id.toString() });

    assert.equal(res.status, 409);
    assert.equal(res.body.code, "SIGNAL_CHANGED");
    assert.equal(vehicleWrites.length, 0);
  });

  test("if the vehicle claim is lost after the signal changed, the signal is rolled back", async () => {
    const vehicle = vehicleDoc();
    const signal = signalDoc();
    stub(EmergencyVehicle, "findById", () => vehicle);
    stub(TrafficSignal, "findOne", () => signal);
    const signalWrites = stub(TrafficSignal, "findOneAndUpdate", (_f, update) => ({
      ...signal,
      priorityOverride: update.$set.priorityOverride,
    }));
    stub(EmergencyVehicle, "updateOne", () => WRITE_MISS);
    const rollback = stub(TrafficSignal, "updateOne", () => WRITE_OK);

    const res = await post("/api/emergency-priority/activate", { vehicleId: vehicle._id.toString() });

    assert.equal(res.status, 409);
    assert.equal(res.body.code, "PRIORITY_ALREADY_ACTIVE");
    assert.equal(signalWrites.length, 1);
    assert.equal(rollback.length, 1);
    assert.equal(String(rollback[0][0]["priorityOverride.vehicle"]), String(vehicle._id));
    assert.equal(rollback[0][1].$set.currentPhase, "EAST_WEST");
    assert.equal(rollback[0][1].$set.greenTime, 35);
    assert.equal(rollback[0][1].$unset.priorityOverride, 1);
  });

  test("maps invalid, unknown, inactive and signal-less cases to 400 / 404 / 409 / 409", async () => {
    const invalid = await post("/api/emergency-priority/activate", { vehicleId: "not-an-id" });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, "INVALID_ID");

    const missing = await post("/api/emergency-priority/activate", {});
    assert.equal(missing.status, 400);

    stub(EmergencyVehicle, "findById", () => null);
    const unknown = await post("/api/emergency-priority/activate", { vehicleId: oid().toString() });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.code, "VEHICLE_NOT_FOUND");
    mock.restoreAll();

    stub(EmergencyVehicle, "findById", () => vehicleDoc({ status: "INACTIVE" }));
    const inactive = await post("/api/emergency-priority/activate", { vehicleId: oid().toString() });
    assert.equal(inactive.status, 409);
    assert.equal(inactive.body.code, "VEHICLE_INACTIVE");
    mock.restoreAll();

    stub(EmergencyVehicle, "findById", () => vehicleDoc());
    stub(TrafficSignal, "findOne", () => null);
    const noSignal = await post("/api/emergency-priority/activate", { vehicleId: oid().toString() });
    assert.equal(noSignal.status, 409);
    assert.equal(noSignal.body.code, "NO_ACTIVE_SIGNAL");
  });

  test("unexpected errors return a generic 500 without internal details", async () => {
    mock.method(console, "error", () => {});
    stub(EmergencyVehicle, "findById", () => {
      throw new Error("connection string mongodb://user:hunter2@host failed");
    });

    const res = await post("/api/emergency-priority/activate", { vehicleId: oid().toString() });

    assert.equal(res.status, 500);
    assert.ok(!res.text.includes("hunter2"), "raw error text must not be returned");
    assert.ok(!("error" in res.body), "no raw error field");
    assert.equal(typeof res.body.message, "string");
  });
});

describe("POST /api/emergency-priority/deactivate", () => {
  test("restores the saved phase and green time, clears the override and the vehicle flags", async () => {
    const vehicle = vehicleDoc({ priorityActive: true, activatedAt: new Date() });
    const signal = signalDoc({
      currentPhase: "NORTH_SOUTH",
      greenTime: 60,
      priorityOverride: {
        vehicle: vehicle._id,
        previousPhase: "EAST_WEST",
        previousGreenTime: 35,
        activatedAt: new Date(),
      },
    });
    stub(EmergencyVehicle, "findById", () => vehicle);
    const lookup = stub(TrafficSignal, "findOne", () => signal);
    const signalWrites = stub(TrafficSignal, "findOneAndUpdate", () => ({
      ...signal,
      currentPhase: "EAST_WEST",
      greenTime: 35,
      priorityOverride: undefined,
    }));
    const vehicleWrites = stub(EmergencyVehicle, "updateOne", () => WRITE_OK);

    const res = await post("/api/emergency-priority/deactivate", { vehicleId: vehicle._id.toString() });

    assert.equal(res.status, 200, res.text);
    assert.deepEqual(lookup[0][0], { "priorityOverride.vehicle": vehicle._id });
    const [filter, update] = signalWrites[0];
    assert.equal(String(filter._id), String(signal._id));
    assert.equal(String(filter["priorityOverride.vehicle"]), String(vehicle._id));
    assert.deepEqual(update.$set, { currentPhase: "EAST_WEST", greenTime: 35 });
    assert.deepEqual(update.$unset, { priorityOverride: 1 });
    assert.deepEqual(vehicleWrites[0][0], { _id: vehicle._id, priorityActive: true });
    assert.deepEqual(vehicleWrites[0][1], {
      $set: { priorityActive: false },
      $unset: { activatedAt: 1 },
    });
    assert.equal(res.body.vehicle.priorityActive, false);
    assert.equal(res.body.signal.currentPhase, "EAST_WEST");
    assert.equal(res.body.signal.greenTime, 35);
    assert.equal(res.body.fallback, null);
  });

  test("deactivating an inactive vehicle returns 409 PRIORITY_NOT_ACTIVE and writes nothing", async () => {
    stub(EmergencyVehicle, "findById", () => vehicleDoc({ priorityActive: false }));
    const signalWrites = stub(TrafficSignal, "findOneAndUpdate", () => null);
    const vehicleWrites = stub(EmergencyVehicle, "updateOne", () => WRITE_OK);

    const res = await post("/api/emergency-priority/deactivate", { vehicleId: oid().toString() });

    assert.equal(res.status, 409);
    assert.equal(res.body.code, "PRIORITY_NOT_ACTIVE");
    assert.equal(signalWrites.length + vehicleWrites.length, 0);
  });

  test("a legacy active vehicle with no saved state keeps the phase, resets green time to 30 and says so", async () => {
    const vehicle = vehicleDoc({ priorityActive: true, activatedAt: new Date() });
    const legacySignal = signalDoc({ currentPhase: "NORTH_SOUTH", greenTime: 60 });
    stub(EmergencyVehicle, "findById", () => vehicle);
    stub(TrafficSignal, "findOne", () => null);
    const signalWrites = stub(TrafficSignal, "findOneAndUpdate", () => ({ ...legacySignal, greenTime: 30 }));
    stub(EmergencyVehicle, "updateOne", () => WRITE_OK);

    const res = await post("/api/emergency-priority/deactivate", { vehicleId: vehicle._id.toString() });

    assert.equal(res.status, 200, res.text);
    const [filter, update] = signalWrites[0];
    assert.equal(String(filter.location), String(LOCATION));
    assert.equal(filter.status, "ACTIVE");
    assert.deepEqual(filter["priorityOverride.vehicle"], { $exists: false });
    assert.deepEqual(update.$set, { greenTime: 30 });
    assert.equal(res.body.fallback, "LEGACY_NO_SAVED_STATE");
    assert.equal(res.body.signal.greenTime, 30);
    assert.equal(res.body.signal.currentPhase, "NORTH_SOUTH");
    assert.equal(res.body.vehicle.priorityActive, false);
  });

  test("losing a concurrent deactivation returns 409 PRIORITY_NOT_ACTIVE", async () => {
    const vehicle = vehicleDoc({ priorityActive: true, activatedAt: new Date() });
    stub(EmergencyVehicle, "findById", () => vehicle);
    stub(TrafficSignal, "findOne", () => null);
    stub(TrafficSignal, "findOneAndUpdate", () => null);
    stub(EmergencyVehicle, "updateOne", () => WRITE_MISS);

    const res = await post("/api/emergency-priority/deactivate", { vehicleId: vehicle._id.toString() });

    assert.equal(res.status, 409);
    assert.equal(res.body.code, "PRIORITY_NOT_ACTIVE");
  });

  test("maps invalid and unknown vehicles and hides internal errors", async () => {
    const invalid = await post("/api/emergency-priority/deactivate", { vehicleId: "nope" });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, "INVALID_ID");

    stub(EmergencyVehicle, "findById", () => null);
    const unknown = await post("/api/emergency-priority/deactivate", { vehicleId: oid().toString() });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.code, "VEHICLE_NOT_FOUND");
    mock.restoreAll();

    mock.method(console, "error", () => {});
    stub(EmergencyVehicle, "findById", () => {
      throw new Error("secret stack detail");
    });
    const failure = await post("/api/emergency-priority/deactivate", { vehicleId: oid().toString() });
    assert.equal(failure.status, 500);
    assert.ok(!failure.text.includes("secret stack detail"));
  });

  test("roles other than ADMIN and EMERGENCY_SERVICE are forbidden", async () => {
    for (const role of ["TRAFFIC_AUTHORITY", "TRAFFIC_POLICE", "CITIZEN"]) {
      const res = await post("/api/emergency-priority/deactivate", { vehicleId: oid().toString() }, role);
      assert.equal(res.status, 403, role);
    }
  });
});

describe("POST /api/signal-optimization/optimize interlock", () => {
  const optimize = (signalId, measurementId) =>
    post("/api/signal-optimization/optimize", { signalId, measurementId }, "TRAFFIC_AUTHORITY");

  const measurement = { _id: oid(), vehicleCount: 120, averageSpeed: 10, trafficDensity: "SEVERE" };

  test("returns 409 and changes nothing while an emergency override is active", async () => {
    const signal = signalDoc({
      currentPhase: "NORTH_SOUTH",
      greenTime: 60,
      priorityOverride: { vehicle: oid(), previousPhase: "EAST_WEST", previousGreenTime: 35, activatedAt: new Date() },
    });
    stub(TrafficSignal, "findById", () => signal);
    stub(TrafficMeasurement, "findById", () => measurement);
    const writes = stub(TrafficSignal, "findOneAndUpdate", () => null);
    signal.save = async () => {
      throw new Error("save must not be called");
    };

    const res = await optimize(signal._id.toString(), measurement._id.toString());

    assert.equal(res.status, 409);
    assert.equal(res.body.code, "EMERGENCY_OVERRIDE_ACTIVE");
    assert.equal(writes.length, 0);
  });

  test("an override claimed between the read and the write is also refused", async () => {
    const signal = signalDoc();
    stub(TrafficSignal, "findById", () => signal);
    stub(TrafficMeasurement, "findById", () => measurement);
    const writes = stub(TrafficSignal, "findOneAndUpdate", () => null);

    const res = await optimize(signal._id.toString(), measurement._id.toString());

    assert.equal(res.status, 409);
    assert.equal(res.body.code, "EMERGENCY_OVERRIDE_ACTIVE");
    assert.deepEqual(writes[0][0]["priorityOverride.vehicle"], { $exists: false });
  });

  test("without an override, optimization behaves as before", async () => {
    const signal = signalDoc({ greenTime: 30 });
    stub(TrafficSignal, "findById", () => signal);
    stub(TrafficMeasurement, "findById", () => measurement);
    stub(TrafficSignal, "findOneAndUpdate", (_f, update) => ({ ...signal, greenTime: update.$set.greenTime }));

    const res = await optimize(signal._id.toString(), measurement._id.toString());

    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.optimization.previousGreenTime, 30);
    assert.equal(res.body.optimization.newGreenTime, 60);
    assert.equal(res.body.message, "Traffic signal optimized successfully");
  });
});
