import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getMonitoringStatuses,
  getRecentAlerts,
} from "./dashboardSummary.js";

test("selects recent alerts in newest-first order without mutating the feed", () => {
  const alerts = [
    { _id: "old", createdAt: "2026-01-01T00:00:00Z" },
    { _id: "new", createdAt: "2026-03-01T00:00:00Z" },
    { _id: "middle", createdAt: "2026-02-01T00:00:00Z" },
  ];

  assert.deepEqual(
    getRecentAlerts(alerts, 2).map((alert) => alert._id),
    ["new", "middle"]
  );
  assert.deepEqual(alerts.map((alert) => alert._id), ["old", "new", "middle"]);
});

test("monitoring status distinguishes empty data from failed feeds", () => {
  const statuses = getMonitoringStatuses({
    analytics: { totalMeasurements: 0 },
    locations: [],
    alerts: [],
    feedErrors: ["Traffic locations: unavailable", "Traffic alerts: unavailable"],
    realtimeStatus: "disconnected",
  });

  assert.deepEqual(
    statuses.map(({ value, state }) => [value, state]),
    [
      ["No measurements", "empty"],
      ["Unavailable", "unavailable"],
      ["Unavailable", "unavailable"],
      ["Disconnected; REST fallback", "unavailable"],
    ]
  );
});

test("monitoring status reports available counts and active alert load", () => {
  const statuses = getMonitoringStatuses({
    analytics: { totalMeasurements: 12 },
    locations: [{ _id: "location-1" }],
    alerts: [{ status: "ACTIVE" }, { status: "RESOLVED" }],
    feedErrors: [],
    realtimeStatus: "connected",
  });

  assert.deepEqual(
    statuses.map(({ value, state }) => [value, state]),
    [
      ["12 recorded", "available"],
      ["1 configured", "available"],
      ["1 active", "warning"],
      ["Connected", "available"],
    ]
  );
});

test("an explicit active alert count wins over a partial alert page", () => {
  const statuses = getMonitoringStatuses({
    analytics: { totalMeasurements: 12 },
    locations: [{ _id: "location-1" }],
    alerts: [{ status: "RESOLVED" }, { status: "RESOLVED" }],
    activeAlertCount: 11,
    feedErrors: [],
    realtimeStatus: "connected",
  });

  assert.deepEqual(
    [statuses[2].value, statuses[2].state],
    ["11 active", "warning"]
  );
});

test("an explicit active alert count of zero reports none active", () => {
  const statuses = getMonitoringStatuses({
    analytics: { totalMeasurements: 12 },
    locations: [],
    alerts: [{ status: "ACTIVE" }],
    activeAlertCount: 0,
    feedErrors: [],
    realtimeStatus: "connected",
  });

  assert.deepEqual(
    [statuses[2].value, statuses[2].state],
    ["None active", "available"]
  );
});
