import assert from "node:assert/strict";
import { test } from "node:test";
import { describeBasis, describeRouteTraffic } from "./routeRecommendationDisplay.js";

const liveStatus = (extra = {}) => ({
  state: "LIVE",
  level: "HIGH",
  coverage: { fresh: 2, total: 2 },
  conflicting: false,
  ageSeconds: 12,
  sources: ["API"],
  ...extra,
});

test("describeBasis labels live measurements and the freshness window", () => {
  const basis = describeBasis({
    basis: "LIVE_MEASUREMENTS",
    fallbackReason: null,
    freshnessThresholdSeconds: 45,
    recommendedRoute: { trafficStatus: liveStatus() },
  });
  assert.equal(basis.live, true);
  assert.match(basis.title, /live measurements/i);
  assert.match(basis.detail, /45 seconds/);
  assert.doesNotMatch(basis.detail, /simulated/i);
});

test("describeBasis says when live measurements are simulated", () => {
  const basis = describeBasis({
    basis: "LIVE_MEASUREMENTS",
    freshnessThresholdSeconds: 45,
    recommendedRoute: { trafficStatus: liveStatus({ sources: ["SIMULATOR"] }) },
  });
  assert.equal(basis.live, true);
  assert.match(basis.detail, /simulated/i);
});

test("describeBasis labels every static fallback as not live and explains why", () => {
  const cases = {
    NO_WAYPOINTS: /no monitored waypoints/i,
    NO_FRESH_DATA: /no fresh measurements/i,
    PARTIAL_DATA: /only some waypoints/i,
  };
  for (const [fallbackReason, expected] of Object.entries(cases)) {
    const basis = describeBasis({
      basis: "STATIC_ROUTE_DATA",
      fallbackReason,
      freshnessThresholdSeconds: 45,
    });
    assert.equal(basis.live, false, fallbackReason);
    assert.match(basis.title, /static route data/i);
    assert.match(basis.title, /not live traffic/i);
    assert.match(basis.detail, expected);
  }
});

test("describeBasis never claims live data when the server reports nothing", () => {
  for (const result of [undefined, null, {}, { basis: "SOMETHING_ELSE" }]) {
    const basis = describeBasis(result);
    assert.equal(basis.live, false);
    assert.match(basis.title, /not live traffic/i);
  }
});

test("describeRouteTraffic shows the live level only for LIVE and PARTIAL routes", () => {
  const live = describeRouteTraffic({ trafficStatus: liveStatus() });
  assert.equal(live.label, "Live: High");
  assert.equal(live.level, "HIGH");
  assert.match(live.detail, /2 of 2 waypoints/);
  assert.match(live.detail, /12 seconds ago/);

  const partial = describeRouteTraffic({
    trafficStatus: liveStatus({ state: "PARTIAL", coverage: { fresh: 1, total: 2 }, level: "LOW" }),
  });
  assert.match(partial.label, /partial/i);
  assert.match(partial.detail, /1 of 2 waypoints/);
  assert.match(partial.detail, /not used for ranking/i);
});

test("describeRouteTraffic flags conflicting readings", () => {
  const status = describeRouteTraffic({ trafficStatus: liveStatus({ conflicting: true }) });
  assert.match(status.detail, /conflicting/i);
});

test("describeRouteTraffic never shows a level for stale, missing or unconfigured routes", () => {
  const stale = describeRouteTraffic({
    trafficStatus: {
      state: "STALE",
      level: null,
      coverage: { fresh: 0, total: 2 },
      lastObservedAt: "2026-10-18T16:00:00.000Z",
    },
  });
  assert.equal(stale.level, null);
  assert.match(stale.label, /stale/i);
  assert.match(stale.detail, /last reading/i);

  assert.match(describeRouteTraffic({ trafficStatus: { state: "NO_DATA", level: null } }).label, /no recent measurements/i);
  assert.match(describeRouteTraffic({ trafficStatus: { state: "NO_WAYPOINTS", level: null } }).label, /no monitored waypoints/i);
  assert.match(describeRouteTraffic({}).label, /not reported/i);
  assert.equal(describeRouteTraffic({}).level, null);
});
