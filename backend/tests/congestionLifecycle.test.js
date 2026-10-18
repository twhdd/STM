const { afterEach, describe, mock, test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const TrafficMeasurement = require("../models/TrafficMeasurement");
const CongestionEvent = require("../models/CongestionEvent");
const TrafficAlert = require("../models/TrafficAlert");
const processingService = require("../services/trafficMeasurementProcessingService");
const trafficAlertService = require("../services/trafficAlertService");
const {
  REALTIME_EVENTS,
  realtimeService,
} = require("../services/realtimeService");

afterEach(() => {
  mock.restoreAll();
});

function createLifecycleHarness({
  failAlertResolutionOnce = false,
  eventInsertRace = false,
  alertInsertRace = false,
} = {}) {
  const locationId = new mongoose.Types.ObjectId();
  const measurements = new Map();
  const events = new Map();
  const alerts = new Map();
  const realtimeEvents = [];
  const operations = [];
  let shouldFailAlertResolution = failAlertResolutionOnce;
  let shouldRaceEventInsert = eventInsertRace;
  let shouldRaceAlertInsert = alertInsertRace;
  const socketServer = {
    to() {
      return {
        emit(eventName, payload) {
          operations.push(`emit:${eventName}`);
          realtimeEvents.push({ eventName, payload });
        },
      };
    },
  };

  mock.method(TrafficMeasurement, "findById", async (id) =>
    measurements.get(String(id)) || null
  );
  mock.method(CongestionEvent, "findOne", async ({ location, status }) =>
    [...events.values()].find(
      (event) =>
        String(event.location) === String(location) && event.status === status
    ) || null
  );
  mock.method(CongestionEvent, "find", async ({ location, status }) =>
    [...events.values()].filter(
      (event) =>
        String(event.location) === String(location) && event.status === status
    )
  );
  mock.method(CongestionEvent, "findById", async (id) =>
    events.get(String(id)) || null
  );
  mock.method(CongestionEvent.prototype, "save", async function () {
    operations.push(`save-event:${this.status}`);
    events.set(String(this._id), this);
    if (this.status === "ACTIVE" && shouldRaceEventInsert) {
      shouldRaceEventInsert = false;
      realtimeService.publishCongestionDetected(this);
      throw Object.assign(new Error("duplicate active event"), {
        code: 11000,
        keyPattern: { location: 1 },
      });
    }
    return this;
  });
  mock.method(TrafficAlert, "findOne", async ({ congestionEvent, status }) =>
    [...alerts.values()].find(
      (alert) =>
        String(alert.congestionEvent) === String(congestionEvent) &&
        alert.status === status
    ) || null
  );
  mock.method(
    TrafficAlert,
    "find",
    async ({ congestionEvent, location, alertType, status }) =>
      [...alerts.values()].filter(
        (alert) =>
          alert.status === status &&
          (congestionEvent === undefined ||
            String(alert.congestionEvent) === String(congestionEvent)) &&
          (location === undefined ||
            String(alert.location) === String(location)) &&
          (alertType === undefined || alert.alertType === alertType)
      )
  );
  mock.method(TrafficAlert.prototype, "save", async function () {
    operations.push(`save-alert:${this.status}`);
    if (this.status === "ACTIVE" && shouldRaceAlertInsert) {
      shouldRaceAlertInsert = false;
      alerts.set(String(this._id), this);
      realtimeService.publishAlertCreated(this);
      throw Object.assign(new Error("duplicate active alert"), {
        code: 11000,
        keyPattern: { congestionEvent: 1 },
      });
    }
    if (this.status === "RESOLVED" && shouldFailAlertResolution) {
      shouldFailAlertResolution = false;
      this.status = "ACTIVE";
      throw new Error("alert resolution persistence failed");
    }
    alerts.set(String(this._id), this);
    return this;
  });

  realtimeService.attach(socketServer);

  function addMeasurement(vehicleCount, averageSpeed) {
    const measurement = {
      _id: new mongoose.Types.ObjectId(),
      location: locationId,
      vehicleCount,
      averageSpeed,
    };
    measurements.set(String(measurement._id), measurement);
    return measurement;
  }

  return {
    locationId,
    measurements,
    events,
    alerts,
    realtimeEvents,
    operations,
    addMeasurement,
    detach() {
      realtimeService.detach(socketServer);
    },
  };
}

describe("congestion episode and alert lifecycle", () => {
  test("duplicate-key races return the active winners without duplicate notifications", async () => {
    const harness = createLifecycleHarness({
      eventInsertRace: true,
      alertInsertRace: true,
    });

    try {
      const measurement = harness.addMeasurement(120, 14);
      const result = await processingService.processTrafficMeasurement(
        measurement._id
      );

      assert.equal(result.completed, true);
      assert.equal(result.congestionDetected, true);
      assert.equal(result.alertCreated, false);
      assert.equal(harness.events.has(String(result.eventId)), true);
      assert.equal(harness.alerts.has(String(result.alertId)), true);
      assert.equal(
        new Set(
          harness.realtimeEvents
            .filter(
              ({ eventName }) =>
                eventName === REALTIME_EVENTS.CONGESTION_DETECTED
            )
            .map(({ payload }) => payload.eventId)
        ).size,
        1
      );
      assert.equal(harness.events.size, 1);
      assert.equal(harness.alerts.size, 1);
      assert.equal(
        harness.realtimeEvents.filter(
          ({ eventName }) =>
            eventName === REALTIME_EVENTS.CONGESTION_DETECTED
        ).length,
        1
      );
      assert.equal(
        harness.realtimeEvents.filter(
          ({ eventName }) => eventName === REALTIME_EVENTS.ALERT_CREATED
        ).length,
        1
      );
      assert.equal(
        new Set(
          harness.realtimeEvents
            .filter(
              ({ eventName }) => eventName === REALTIME_EVENTS.ALERT_CREATED
            )
            .map(({ payload }) => payload.alertId)
        ).size,
        1
      );
    } finally {
      harness.detach();
    }
  });

  test("repeated congested measurements and duplicate processing keep one active event and alert", async () => {
    const harness = createLifecycleHarness();

    try {
      const firstMeasurement = harness.addMeasurement(130, 12);
      const secondMeasurement = harness.addMeasurement(112, 14);

      const firstResult = await processingService.processTrafficMeasurement(
        firstMeasurement._id
      );
      const secondResult = await processingService.processTrafficMeasurement(
        secondMeasurement._id
      );
      const repeatedResult = await processingService.processTrafficMeasurement(
        secondMeasurement._id
      );

      assert.equal(harness.events.size, 1);
      assert.equal(harness.alerts.size, 1);
      assert.equal(firstResult.eventId, secondResult.eventId);
      assert.equal(secondResult.eventId, repeatedResult.eventId);
      assert.equal(secondResult.alertCreated, false);
      assert.equal(repeatedResult.alertCreated, false);
      assert.deepEqual(
        harness.realtimeEvents.map(({ eventName }) => eventName),
        [
          REALTIME_EVENTS.CONGESTION_DETECTED,
          REALTIME_EVENTS.ALERT_CREATED,
        ]
      );
    } finally {
      harness.detach();
    }
  });

  test("persistent congestion shares one event even when measurements process concurrently", async () => {
    const harness = createLifecycleHarness();

    try {
      const measurements = [
        harness.addMeasurement(105, 14),
        harness.addMeasurement(126, 11),
        harness.addMeasurement(79, 22),
      ];

      const results = await Promise.all(
        measurements.map(({ _id }) =>
          processingService.processTrafficMeasurement(_id)
        )
      );

      assert.equal(harness.events.size, 1);
      assert.equal(harness.alerts.size, 1);
      assert.equal(new Set(results.map(({ eventId }) => String(eventId))).size, 1);
      assert.equal(
        harness.realtimeEvents.filter(
          ({ eventName }) =>
            eventName === REALTIME_EVENTS.CONGESTION_DETECTED
        ).length,
        1
      );
      assert.equal(
        harness.realtimeEvents.filter(
          ({ eventName }) => eventName === REALTIME_EVENTS.ALERT_CREATED
        ).length,
        1
      );
    } finally {
      harness.detach();
    }
  });

  test("a below-threshold measurement resolves the active event and alert once", async () => {
    const harness = createLifecycleHarness();

    try {
      const congested = harness.addMeasurement(120, 14);
      const cleared = harness.addMeasurement(28, 42);
      const repeatedClear = harness.addMeasurement(25, 45);

      const created = await processingService.processTrafficMeasurement(
        congested._id
      );
      const clearedResult = await processingService.processTrafficMeasurement(
        cleared._id
      );
      const repeatedClearResult =
        await processingService.processTrafficMeasurement(repeatedClear._id);

      const event = harness.events.get(String(created.eventId));
      const alert = [...harness.alerts.values()][0];
      assert.equal(event.status, "RESOLVED");
      assert.ok(event.resolvedAt instanceof Date);
      assert.equal(alert.status, "RESOLVED");
      assert.ok(alert.resolvedAt instanceof Date);
      const lateAlertResult = await trafficAlertService.createCongestionAlert(
        event._id
      );
      assert.equal(lateAlertResult.alertCreated, false);
      assert.equal(harness.alerts.size, 1);
      assert.equal(clearedResult.congestionDetected, false);
      assert.match(clearedResult.message, /cleared/i);
      assert.equal(repeatedClearResult.congestionDetected, false);
      assert.equal(
        harness.realtimeEvents.filter(
          ({ eventName }) =>
            eventName === REALTIME_EVENTS.CONGESTION_CLEARED
        ).length,
        1
      );
      assert.equal(
        harness.realtimeEvents.filter(
          ({ eventName }) => eventName === REALTIME_EVENTS.ALERT_RESOLVED
        ).length,
        1
      );
      assert.deepEqual(harness.operations, [
        `save-event:ACTIVE`,
        `emit:${REALTIME_EVENTS.CONGESTION_DETECTED}`,
        `save-alert:ACTIVE`,
        `emit:${REALTIME_EVENTS.ALERT_CREATED}`,
        `save-event:RESOLVED`,
        `emit:${REALTIME_EVENTS.CONGESTION_CLEARED}`,
        `save-alert:RESOLVED`,
        `emit:${REALTIME_EVENTS.ALERT_RESOLVED}`,
      ]);
    } finally {
      harness.detach();
    }
  });

  test("a new congested measurement after clearance starts a new event and alert episode", async () => {
    const harness = createLifecycleHarness();

    try {
      const firstEpisode = harness.addMeasurement(120, 14);
      const cleared = harness.addMeasurement(20, 48);
      const secondEpisode = harness.addMeasurement(115, 13);

      const first = await processingService.processTrafficMeasurement(
        firstEpisode._id
      );
      await processingService.processTrafficMeasurement(cleared._id);
      const second = await processingService.processTrafficMeasurement(
        secondEpisode._id
      );

      assert.equal(harness.events.size, 2);
      assert.equal(harness.alerts.size, 2);
      assert.notEqual(String(first.eventId), String(second.eventId));
      assert.equal(
        [...harness.events.values()].filter(
          ({ status }) => status === "ACTIVE"
        ).length,
        1
      );
      assert.equal(
        [...harness.alerts.values()].filter(
          ({ status }) => status === "ACTIVE"
        ).length,
        1
      );
      assert.deepEqual(
        harness.realtimeEvents.map(({ eventName }) => eventName),
        [
          REALTIME_EVENTS.CONGESTION_DETECTED,
          REALTIME_EVENTS.ALERT_CREATED,
          REALTIME_EVENTS.CONGESTION_CLEARED,
          REALTIME_EVENTS.ALERT_RESOLVED,
          REALTIME_EVENTS.CONGESTION_DETECTED,
          REALTIME_EVENTS.ALERT_CREATED,
        ]
      );
    } finally {
      harness.detach();
    }
  });

  test("a later clear measurement retries resolving alerts after a partial clear failure", async () => {
    const harness = createLifecycleHarness({
      failAlertResolutionOnce: true,
    });

    try {
      const congested = harness.addMeasurement(120, 14);
      const firstClear = harness.addMeasurement(20, 48);
      const retryClear = harness.addMeasurement(18, 50);
      const created = await processingService.processTrafficMeasurement(
        congested._id
      );

      await assert.rejects(
        processingService.processTrafficMeasurement(firstClear._id),
        /alert resolution persistence failed/
      );
      assert.equal(harness.events.get(String(created.eventId)).status, "RESOLVED");
      assert.equal([...harness.alerts.values()][0].status, "ACTIVE");

      const retry = await processingService.processTrafficMeasurement(
        retryClear._id
      );
      assert.equal(retry.congestionDetected, false);
      assert.equal([...harness.alerts.values()][0].status, "RESOLVED");
      assert.equal(
        harness.realtimeEvents.filter(
          ({ eventName }) => eventName === REALTIME_EVENTS.ALERT_RESOLVED
        ).length,
        1
      );
    } finally {
      harness.detach();
    }
  });
});
