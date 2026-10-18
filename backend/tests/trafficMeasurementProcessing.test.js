const { afterEach, describe, mock, test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

mongoose.set("bufferCommands", false);

const TrafficMeasurement = require("../models/TrafficMeasurement");
const CongestionEvent = require("../models/CongestionEvent");
const TrafficAlert = require("../models/TrafficAlert");
const processingService = require("../services/trafficMeasurementProcessingService");
const { trafficMeasurementRecoveryWorker } = require("../services/trafficMeasurementRecoveryWorker");
const { createTrafficMeasurement } = require("../controllers/trafficMeasurementController");

const MEASUREMENT_ID = "507f1f77bcf86cd799439011";
const LOCATION_ID = "507f1f77bcf86cd799439022";
const DEVICE_ID = "507f1f77bcf86cd799439033";

afterEach(() => mock.restoreAll());

function stubProcessingModels({
  vehicleCount = 120,
  averageSpeed = 12,
  failMeasurementLookup = false,
  failAlertSave = false,
} = {}) {
  const measurement = {
    _id: MEASUREMENT_ID,
    location: LOCATION_ID,
    vehicleCount,
    averageSpeed,
  };
  const eventsByLocation = new Map();
  const eventsById = new Map();
  const alertsByEvent = new Map();
  let eventSaveCount = 0;
  let alertSaveCount = 0;

  mock.method(TrafficMeasurement, "findById", async () => {
    if (failMeasurementLookup) throw new Error("measurement lookup failed");
    return measurement;
  });
  mock.method(CongestionEvent, "findOne", async ({ location, status }) => {
    const event = eventsByLocation.get(String(location));
    return status === "ACTIVE" && event?.status === "ACTIVE" ? event : null;
  });
  mock.method(CongestionEvent, "find", async ({ location, status }) => {
    const event = eventsByLocation.get(String(location));
    return status === "ACTIVE" && event?.status === "ACTIVE" ? [event] : [];
  });
  mock.method(CongestionEvent, "findById", async (id) =>
    eventsById.get(String(id)) || null
  );
  mock.method(TrafficAlert, "findOne", async ({ congestionEvent: id, status }) => {
    const alert = alertsByEvent.get(String(id));
    return status === "ACTIVE" && alert?.status === "ACTIVE" ? alert : null;
  });
  mock.method(TrafficAlert, "find", async ({ congestionEvent: id, status }) => {
    const alert = alertsByEvent.get(String(id));
    return status === "ACTIVE" && alert?.status === "ACTIVE" ? [alert] : [];
  });
  mock.method(CongestionEvent.prototype, "save", async function () {
    eventSaveCount += 1;
    eventsByLocation.set(String(this.location), this);
    eventsById.set(String(this._id), this);
    return this;
  });
  mock.method(TrafficAlert.prototype, "save", async function () {
    alertSaveCount += 1;
    if (failAlertSave) throw new Error("alert persistence failed");
    alertsByEvent.set(String(this.congestionEvent), this);
    return this;
  });

  return {
    measurement,
    eventsByLocation,
    alertsByEvent,
    get eventSaveCount() {
      return eventSaveCount;
    },
    get alertSaveCount() {
      return alertSaveCount;
    },
  };
}

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

describe("automatic traffic measurement processing", () => {
  test("new measurements initialize private durable processing metadata", () => {
    const measurement = new TrafficMeasurement({
      device: DEVICE_ID,
      location: LOCATION_ID,
      vehicleCount: 30,
      averageSpeed: 40,
      trafficDensity: "LOW",
    });
    const serialized = measurement.toJSON();

    assert.equal(measurement.processing.status, "PENDING");
    assert.equal(measurement.processing.attempts, 0);
    assert.equal(serialized.processing, undefined);
    assert.equal(TrafficMeasurement.schema.options.autoIndex, false);
    assert.ok(
      TrafficMeasurement.schema.indexes().some(
        ([, options]) => options.name === "traffic_measurement_processing_queue"
      )
    );
  });

  test("creates one congestion event and alert for a congested measurement", async () => {
    const models = stubProcessingModels();
    const result = await processingService.processTrafficMeasurement(MEASUREMENT_ID);

    assert.equal(result.completed, true);
    assert.equal(result.congestionDetected, true);
    assert.equal(result.congestionLevel, "SEVERE");
    assert.equal(result.alertCreated, true);
    assert.equal(models.eventSaveCount, 1);
    assert.equal(models.alertSaveCount, 1);
  });

  test("repeat processing reuses the active event and alert", async () => {
    const models = stubProcessingModels();

    const first = await processingService.processTrafficMeasurement(MEASUREMENT_ID);
    const repeated = await processingService.processTrafficMeasurement(MEASUREMENT_ID);

    assert.equal(first.eventId, repeated.eventId);
    assert.equal(first.alertId, repeated.alertId);
    assert.equal(repeated.alertCreated, false);
    assert.equal(models.eventSaveCount, 1);
    assert.equal(models.alertSaveCount, 1);
  });

  test("non-congested measurements do not create events or alerts", async () => {
    const models = stubProcessingModels({ vehicleCount: 20, averageSpeed: 45 });
    const result = await processingService.processTrafficMeasurement(MEASUREMENT_ID);

    assert.equal(result.completed, true);
    assert.equal(result.congestionDetected, false);
    assert.equal(result.congestionLevel, "LOW");
    assert.equal(result.alertCreated, false);
    assert.equal(models.eventSaveCount, 0);
    assert.equal(models.alertSaveCount, 0);
  });

  test("detector errors are surfaced to the caller", async () => {
    stubProcessingModels({ failMeasurementLookup: true });
    await assert.rejects(
      processingService.processTrafficMeasurement(MEASUREMENT_ID),
      /measurement lookup failed/
    );
  });

  test("alert persistence errors are surfaced after event detection", async () => {
    const models = stubProcessingModels({ failAlertSave: true });
    await assert.rejects(
      processingService.processTrafficMeasurement(MEASUREMENT_ID),
      /alert persistence failed/
    );
    assert.equal(models.eventSaveCount, 1);
    assert.equal(models.alertSaveCount, 1);
  });

  test("measurement creation starts processing only after persistence succeeds", async () => {
    let measurementPersisted = false;
    mock.method(TrafficMeasurement.prototype, "save", async function () {
      measurementPersisted = true;
      assert.equal(this.processing.status, "PENDING");
      assert.equal(this.processing.attempts, 0);
      assert.equal(this.toJSON().processing, undefined);
      return this;
    });
    mock.method(trafficMeasurementRecoveryWorker, "processMeasurementNow", async () => {
      assert.equal(measurementPersisted, true);
      return {
        completed: true,
        congestionDetected: false,
        congestionLevel: "LOW",
        alertCreated: false,
      };
    });
    const response = createResponse();

    await createTrafficMeasurement(
      {
        body: {
          device: DEVICE_ID,
          location: LOCATION_ID,
          vehicleCount: 20,
          averageSpeed: 45,
          trafficDensity: "LOW",
        },
      },
      response
    );

    assert.equal(response.statusCode, 201);
    assert.equal(response.body.processing.completed, true);
    assert.equal(response.body.measurement.toJSON().processing, undefined);
  });

  test("API-created measurements default to API and ignore a client source spoof", async () => {
    const saved = [];
    mock.method(TrafficMeasurement.prototype, "save", async function () {
      saved.push(this);
      return this;
    });
    mock.method(trafficMeasurementRecoveryWorker, "processMeasurementNow", async () => ({
      completed: true,
      congestionDetected: false,
      congestionLevel: "LOW",
      alertCreated: false,
    }));

    const spoofedResponse = createResponse();
    await createTrafficMeasurement(
      {
        body: {
          device: DEVICE_ID,
          location: LOCATION_ID,
          vehicleCount: 20,
          averageSpeed: 45,
          trafficDensity: "LOW",
          source: "SIMULATOR",
        },
      },
      spoofedResponse
    );

    const ordinaryResponse = createResponse();
    await createTrafficMeasurement(
      {
        body: {
          device: DEVICE_ID,
          location: LOCATION_ID,
          vehicleCount: 22,
          averageSpeed: 43,
          trafficDensity: "LOW",
        },
      },
      ordinaryResponse
    );

    assert.equal(spoofedResponse.statusCode, 201);
    assert.equal(ordinaryResponse.statusCode, 201);
    assert.equal(saved[0].source, "API");
    assert.equal(saved[1].source, "API");
  });

  test("saved measurements return 201 with explicit processing failure when processing fails", async () => {
    mock.method(TrafficMeasurement.prototype, "save", async function () {
      this._id = MEASUREMENT_ID;
      return this;
    });
    mock.method(trafficMeasurementRecoveryWorker, "processMeasurementNow", async () => {
      throw new Error("processing unavailable");
    });
    const errorLog = mock.method(console, "error", () => {});
    const response = createResponse();

    await createTrafficMeasurement(
      {
        body: {
          device: DEVICE_ID,
          location: LOCATION_ID,
          vehicleCount: 120,
          averageSpeed: 12,
          trafficDensity: "SEVERE",
        },
      },
      response
    );

    assert.equal(response.statusCode, 201);
    assert.ok(response.body.measurement._id);
    assert.equal(response.body.processing.completed, false);
    assert.match(response.body.processing.message, /measurement was saved/i);
    assert.equal(errorLog.mock.callCount(), 1);
  });

  test("measurement persistence failures return 500 without starting processing", async () => {
    mock.method(TrafficMeasurement.prototype, "save", async () => {
      throw new Error("measurement persistence failed");
    });
    const process = mock.method(trafficMeasurementRecoveryWorker, "processMeasurementNow");
    const response = createResponse();

    await createTrafficMeasurement(
      {
        body: {
          device: DEVICE_ID,
          location: LOCATION_ID,
          vehicleCount: 20,
          averageSpeed: 45,
          trafficDensity: "LOW",
        },
      },
      response
    );

    assert.equal(response.statusCode, 500);
    assert.equal(process.mock.callCount(), 0);
  });
});
