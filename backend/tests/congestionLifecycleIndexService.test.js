const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const CongestionEvent = require("../models/CongestionEvent");
const TrafficAlert = require("../models/TrafficAlert");
const {
  ACTIVE_ALERT_CONFLICT_PIPELINE,
  ACTIVE_EVENT_CONFLICT_PIPELINE,
  ensureCongestionLifecycleIndexes,
} = require("../services/congestionLifecycleIndexService");

describe("congestion lifecycle index safeguards", () => {
  test("declares partial unique indexes matching the active record invariants", () => {
    const eventIndex = CongestionEvent.schema.indexes().find(
      ([, options]) => options.name === "active_congestion_event_per_location"
    );
    const alertIndex = TrafficAlert.schema.indexes().find(
      ([, options]) => options.name === "active_congestion_alert_per_event"
    );

    assert.ok(eventIndex);
    assert.deepEqual(eventIndex[0], { location: 1 });
    assert.equal(eventIndex[1].unique, true);
    assert.deepEqual(eventIndex[1].partialFilterExpression, {
      status: "ACTIVE",
      location: { $type: "objectId" },
    });

    assert.ok(alertIndex);
    assert.deepEqual(alertIndex[0], { congestionEvent: 1 });
    assert.equal(alertIndex[1].unique, true);
    assert.deepEqual(alertIndex[1].partialFilterExpression, {
      alertType: "CONGESTION",
      status: "ACTIVE",
      congestionEvent: { $type: "objectId" },
    });
    assert.equal(CongestionEvent.schema.options.autoIndex, false);
    assert.equal(TrafficAlert.schema.options.autoIndex, false);
    assert.equal(
      ACTIVE_EVENT_CONFLICT_PIPELINE[0].$match.location.$type,
      eventIndex[1].partialFilterExpression.location.$type
    );
    assert.equal(
      ACTIVE_ALERT_CONFLICT_PIPELINE[0].$match.congestionEvent.$type,
      alertIndex[1].partialFilterExpression.congestionEvent.$type
    );
  });

  test("reports conflicting active groups and does not create either index", async () => {
    const locationId = "location-conflict";
    const eventId = "event-conflict";
    const log = [];
    const eventModel = {
      async aggregate(pipeline) {
        assert.equal(pipeline[0].$match.status, "ACTIVE");
        return [{ _id: locationId, count: 2, firstRecordId: "event-1", lastRecordId: "event-2" }];
      },
      async createIndexes() {
        log.push("event-index-created");
      },
    };
    const alertModel = {
      async aggregate(pipeline) {
        assert.equal(pipeline[0].$match.status, "ACTIVE");
        return [{ _id: eventId, count: 3, firstRecordId: "alert-1", lastRecordId: "alert-3" }];
      },
      async createIndexes() {
        log.push("alert-index-created");
      },
    };
    const logger = {
      error(message) {
        log.push(message);
      },
    };

    await assert.rejects(
      ensureCongestionLifecycleIndexes({
        congestionEventModel: eventModel,
        trafficAlertModel: alertModel,
        logger,
      }),
      (error) => {
        assert.match(error.message, /no records were changed/i);
        assert.match(error.message, /location location-conflict: 2 active records/);
        assert.match(error.message, /congestion event event-conflict: 3 active records/);
        assert.match(error.message, /event-1, event-2/);
        assert.match(error.message, /alert-1, alert-3/);
        return true;
      }
    );
    assert.equal(log.length, 1);
    assert.match(log[0], /Refusing to create congestion lifecycle unique indexes/);
  });

  test("creates indexes only after both conflict scans complete", async () => {
    const operations = [];
    const eventModel = {
      async aggregate() {
        operations.push("events-scanned");
        return [];
      },
      async createIndexes() {
        assert.equal(
          operations.filter((operation) => operation.endsWith("-scanned")).length,
          2
        );
        operations.push("event-index-created");
      },
    };
    const alertModel = {
      async aggregate() {
        operations.push("alerts-scanned");
        return [];
      },
      async createIndexes() {
        assert.equal(
          operations.filter((operation) => operation.endsWith("-scanned")).length,
          2
        );
        operations.push("alert-index-created");
      },
    };

    await ensureCongestionLifecycleIndexes({
      congestionEventModel: eventModel,
      trafficAlertModel: alertModel,
      logger: { error() { assert.fail("unexpected index error"); } },
    });

    assert.equal(operations.length, 4);
    assert.ok(operations.includes("events-scanned"));
    assert.ok(operations.includes("alerts-scanned"));
    assert.ok(operations.includes("event-index-created"));
    assert.ok(operations.includes("alert-index-created"));
  });
});
