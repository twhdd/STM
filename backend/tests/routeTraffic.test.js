// Traffic-aware route recommendation tests. Run: npm test (from backend/)
// No database needed: model methods are stubbed.
const { afterEach, describe, test, mock } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const Route = require("../models/Route");
const TrafficMeasurement = require("../models/TrafficMeasurement");
const { recommendRoute } = require("../services/routeRecommendationService");
const {
  getRecommendedRoute,
} = require("../controllers/routeRecommendationController");

afterEach(() => mock.restoreAll());

const oid = () => new mongoose.Types.ObjectId();
const START_ID = oid().toString();
const END_ID = oid().toString();
const W1 = oid().toString();
const W2 = oid().toString();
const W3 = oid().toString();
const NOW = new Date("2026-10-25T12:00:00.000Z");
const FRESH_MS = 45_000;
const secondsAgo = (s) => new Date(NOW.getTime() - s * 1000);

// A stored latest-observation row as the aggregation returns it.
const reading = (location, level, ageSeconds, source = "API") => ({
  _id: new mongoose.Types.ObjectId(location),
  trafficDensity: level,
  measuredAt: secondsAgo(ageSeconds),
  source,
});

const storedRoute = (overrides = {}) => ({
  routeId: "R",
  name: "Route",
  distance: 5,
  estimatedTime: 10,
  trafficLevel: "LOW",
  status: "AVAILABLE",
  ...overrides,
});

function stubData(routes, rows) {
  mock.method(Route, "find", async () => routes);
  const pipelines = [];
  mock.method(TrafficMeasurement, "aggregate", async (pipeline) => {
    pipelines.push(pipeline);
    return typeof rows === "function" ? rows() : rows;
  });
  return pipelines;
}

describe("freshness configuration", () => {
  const { loadRouteTrafficConfig, DEFAULT_FRESHNESS_MS } = (() => {
    try {
      return require("../config/routeTraffic");
    } catch {
      return {};
    }
  })();

  test("defaults to 45 seconds, three times the 15 second sampling interval", () => {
    assert.equal(DEFAULT_FRESHNESS_MS, 45_000);
    assert.equal(loadRouteTrafficConfig({}).freshnessMs, 45_000);
  });

  test("accepts an explicit override and rejects unusable values", () => {
    assert.equal(
      loadRouteTrafficConfig({ STM_ROUTE_TRAFFIC_FRESHNESS_MS: "90000" }).freshnessMs,
      90_000
    );
    for (const value of ["abc", "999", "1.5", "-1", "3600001", ""]) {
      assert.throws(
        () => loadRouteTrafficConfig({ STM_ROUTE_TRAFFIC_FRESHNESS_MS: value }),
        /STM_ROUTE_TRAFFIC_FRESHNESS_MS/,
        value
      );
    }
  });
});

describe("Route schema waypoints", () => {
  test("waypoints are optional and absent by default", async () => {
    const route = new Route({
      routeId: "R1",
      name: "n",
      startLocation: oid(),
      endLocation: oid(),
      distance: 1,
      estimatedTime: 1,
    });
    await route.validate();
    assert.equal(route.waypoints, undefined);
  });

  test("waypoints keep their order and reference traffic locations", async () => {
    const ids = [oid(), oid(), oid()];
    const route = new Route({
      routeId: "R1",
      name: "n",
      startLocation: oid(),
      endLocation: oid(),
      distance: 1,
      estimatedTime: 1,
      waypoints: ids,
    });
    await route.validate();
    assert.deepEqual(route.waypoints.map(String), ids.map(String));
    assert.equal(Route.schema.path("waypoints").embeddedSchemaType.options.ref, "TrafficLocation");
  });

  test("an invalid waypoint id fails validation", async () => {
    const route = new Route({
      routeId: "R1",
      name: "n",
      startLocation: oid(),
      endLocation: oid(),
      distance: 1,
      estimatedTime: 1,
      waypoints: ["not-an-id"],
    });
    await assert.rejects(route.validate(), { name: "ValidationError" });
  });
});

describe("classifyObservation", () => {
  const { classifyObservation } = require("../services/routeTrafficService");
  const at = (seconds, extra = {}) => ({
    trafficDensity: "HIGH",
    measuredAt: secondsAgo(seconds),
    source: "SIMULATOR",
    ...extra,
  });

  test("no reading is MISSING", () => {
    assert.equal(classifyObservation(undefined, NOW, FRESH_MS).state, "MISSING");
  });

  test("a reading exactly at the threshold is FRESH, one millisecond older is STALE", () => {
    assert.equal(classifyObservation(at(45), NOW, FRESH_MS).state, "FRESH");
    const justOver = { trafficDensity: "HIGH", measuredAt: new Date(NOW.getTime() - FRESH_MS - 1) };
    assert.equal(classifyObservation(justOver, NOW, FRESH_MS).state, "STALE");
  });

  test("a slightly future timestamp is tolerated as age zero, a clearly future one is INVALID", () => {
    const slight = classifyObservation(at(-3), NOW, FRESH_MS);
    assert.equal(slight.state, "FRESH");
    assert.equal(slight.ageMs, 0);
    assert.equal(classifyObservation(at(-60), NOW, FRESH_MS).state, "INVALID");
  });

  test("an unknown density or an unreadable timestamp is INVALID", () => {
    assert.equal(classifyObservation(at(1, { trafficDensity: "JAMMED" }), NOW, FRESH_MS).state, "INVALID");
    assert.equal(classifyObservation(at(1, { trafficDensity: undefined }), NOW, FRESH_MS).state, "INVALID");
    assert.equal(classifyObservation(at(1, { measuredAt: "garbage" }), NOW, FRESH_MS).state, "INVALID");
    assert.equal(classifyObservation(at(1, { measuredAt: undefined }), NOW, FRESH_MS).state, "INVALID");
  });
});

describe("summarizeRouteTraffic", () => {
  const { summarizeRouteTraffic } = require("../services/routeTrafficService");
  const obs = (...rows) => new Map(rows.map((row) => [String(row._id), row]));
  const summarize = (waypoints, rows) =>
    summarizeRouteTraffic({ waypoints: waypoints.map((id) => new mongoose.Types.ObjectId(id)) }, obs(...rows), NOW, FRESH_MS);

  test("a route without waypoints is NO_WAYPOINTS (absent, undefined or empty)", () => {
    for (const route of [{}, { waypoints: undefined }, { waypoints: [] }]) {
      const status = summarizeRouteTraffic(route, new Map(), NOW, FRESH_MS);
      assert.equal(status.state, "NO_WAYPOINTS");
      assert.equal(status.level, null);
      assert.deepEqual(status.coverage, { fresh: 0, total: 0 });
    }
  });

  test("LIVE when every waypoint is fresh; the worst reading decides the level", () => {
    const status = summarize(
      [W1, W2, W3],
      [reading(W1, "LOW", 5), reading(W2, "HIGH", 20, "SIMULATOR"), reading(W3, "MEDIUM", 10)]
    );
    assert.equal(status.state, "LIVE");
    assert.equal(status.level, "HIGH");
    assert.deepEqual(status.coverage, { fresh: 3, total: 3 });
    assert.equal(status.limitingWaypoint, W2);
    assert.equal(status.ageSeconds, 20);
    assert.equal(status.dataAsOf, secondsAgo(20).toISOString());
    assert.deepEqual(status.sources, ["API", "SIMULATOR"]);
    assert.equal(status.lastObservedAt, null);
  });

  test("readings two or more levels apart are flagged as conflicting, adjacent ones are not", () => {
    assert.equal(summarize([W1, W2], [reading(W1, "LOW", 1), reading(W2, "HIGH", 1)]).conflicting, true);
    assert.equal(summarize([W1, W2], [reading(W1, "LOW", 1), reading(W2, "MEDIUM", 1)]).conflicting, false);
    assert.equal(summarize([W1], [reading(W1, "SEVERE", 1)]).conflicting, false);
  });

  test("ties for the worst level keep the first waypoint as the limiting one", () => {
    const status = summarize([W2, W1], [reading(W1, "HIGH", 1), reading(W2, "HIGH", 1)]);
    assert.equal(status.limitingWaypoint, W2);
  });

  test("PARTIAL when only some waypoints are fresh: only fresh readings are used", () => {
    const status = summarize([W1, W2], [reading(W1, "LOW", 5), reading(W2, "SEVERE", 600)]);
    assert.equal(status.state, "PARTIAL");
    assert.equal(status.level, "LOW");
    assert.deepEqual(status.coverage, { fresh: 1, total: 2 });
  });

  test("STALE when nothing is fresh but old readings exist; the stale level is never presented as current", () => {
    const status = summarize([W1, W2], [reading(W1, "SEVERE", 300), reading(W2, "HIGH", 100)]);
    assert.equal(status.state, "STALE");
    assert.equal(status.level, null);
    assert.equal(status.lastObservedAt, secondsAgo(100).toISOString());
    assert.deepEqual(status.coverage, { fresh: 0, total: 2 });
  });

  test("NO_DATA when no waypoint has any usable reading (missing or invalid)", () => {
    assert.equal(summarize([W1, W2], []).state, "NO_DATA");
    const invalid = summarize([W1], [{ ...reading(W1, "LOW", 1), trafficDensity: "JAMMED" }]);
    assert.equal(invalid.state, "NO_DATA");
    assert.equal(invalid.level, null);
  });

  test("a waypoint listed twice counts once", () => {
    const status = summarize([W1, W1, W2], [reading(W1, "LOW", 1), reading(W2, "LOW", 1)]);
    assert.deepEqual(status.coverage, { fresh: 2, total: 2 });
  });
});

describe("basis and ranking", () => {
  const { selectBasis, rankRoutes } = require("../services/routeTrafficService");
  const entry = (route, state, level = null) => ({ route, status: { state, level } });

  test("live ranking is used only when every route is LIVE", () => {
    assert.deepEqual(selectBasis([{ state: "LIVE" }, { state: "LIVE" }]), {
      basis: "LIVE_MEASUREMENTS",
      fallbackReason: null,
    });
    assert.equal(selectBasis([{ state: "LIVE" }, { state: "PARTIAL" }]).basis, "STATIC_ROUTE_DATA");
  });

  test("fallback reasons are prioritised NO_WAYPOINTS, then NO_FRESH_DATA, then PARTIAL_DATA", () => {
    assert.equal(selectBasis([{ state: "NO_WAYPOINTS" }, { state: "STALE" }, { state: "PARTIAL" }]).fallbackReason, "NO_WAYPOINTS");
    assert.equal(selectBasis([{ state: "LIVE" }, { state: "STALE" }, { state: "PARTIAL" }]).fallbackReason, "NO_FRESH_DATA");
    assert.equal(selectBasis([{ state: "NO_DATA" }, { state: "PARTIAL" }]).fallbackReason, "NO_FRESH_DATA");
    assert.equal(selectBasis([{ state: "LIVE" }, { state: "PARTIAL" }]).fallbackReason, "PARTIAL_DATA");
  });

  test("live ranking orders by live level, then stored time, then distance, then route id", () => {
    const entries = [
      entry({ routeId: "D", estimatedTime: 10, distance: 5, trafficLevel: "LOW" }, "LIVE", "HIGH"),
      entry({ routeId: "C", estimatedTime: 12, distance: 5, trafficLevel: "LOW" }, "LIVE", "LOW"),
      entry({ routeId: "B", estimatedTime: 10, distance: 6, trafficLevel: "LOW" }, "LIVE", "LOW"),
      entry({ routeId: "A", estimatedTime: 10, distance: 5, trafficLevel: "LOW" }, "LIVE", "LOW"),
    ];
    assert.deepEqual(
      rankRoutes(entries, "LIVE_MEASUREMENTS").map((e) => e.route.routeId),
      ["A", "B", "C", "D"]
    );
  });

  test("static ranking ignores live data entirely", () => {
    const entries = [
      entry({ routeId: "S-HIGH", estimatedTime: 5, distance: 1, trafficLevel: "HIGH" }, "LIVE", "LOW"),
      entry({ routeId: "S-LOW", estimatedTime: 30, distance: 9, trafficLevel: "LOW" }, "NO_WAYPOINTS"),
    ];
    assert.deepEqual(
      rankRoutes(entries, "STATIC_ROUTE_DATA").map((e) => e.route.routeId),
      ["S-LOW", "S-HIGH"]
    );
  });

  test("ranking is deterministic regardless of input order and does not mutate the input", () => {
    const base = ["A", "B", "C"].map((id) =>
      entry({ routeId: id, estimatedTime: 10, distance: 5, trafficLevel: "LOW" }, "LIVE", "LOW")
    );
    const input = [base[2], base[0], base[1]];
    const snapshot = input.map((e) => e.route.routeId);
    assert.deepEqual(rankRoutes(input, "LIVE_MEASUREMENTS").map((e) => e.route.routeId), ["A", "B", "C"]);
    assert.deepEqual(rankRoutes([...input].reverse(), "LIVE_MEASUREMENTS").map((e) => e.route.routeId), ["A", "B", "C"]);
    assert.deepEqual(input.map((e) => e.route.routeId), snapshot);
  });
});

describe("recommendRoute with waypoints", () => {
  const twoRoutes = () => [
    storedRoute({ routeId: "FAST", name: "Fast", estimatedTime: 10, trafficLevel: "SEVERE", waypoints: [W1] }),
    storedRoute({ routeId: "SLOW", name: "Slow", estimatedTime: 25, trafficLevel: "LOW", waypoints: [W2] }),
  ];

  test("changing the relevant measurements changes the ranking", async () => {
    stubData(twoRoutes(), [reading(W1, "LOW", 5), reading(W2, "SEVERE", 5)]);
    const quietFast = await recommendRoute(START_ID, END_ID, { now: NOW });
    assert.equal(quietFast.basis, "LIVE_MEASUREMENTS");
    assert.equal(quietFast.recommendedRoute.routeId, "FAST");

    mock.restoreAll();
    stubData(twoRoutes(), [reading(W1, "SEVERE", 5), reading(W2, "LOW", 5)]);
    const congestedFast = await recommendRoute(START_ID, END_ID, { now: NOW });
    assert.equal(congestedFast.basis, "LIVE_MEASUREMENTS");
    assert.equal(congestedFast.recommendedRoute.routeId, "SLOW");
    assert.deepEqual(congestedFast.alternatives.map((r) => r.routeId), ["FAST"]);
  });

  test("returns the live status, keeps the stored fields and the original contract", async () => {
    stubData(twoRoutes(), [reading(W1, "MEDIUM", 12, "SIMULATOR"), reading(W2, "HIGH", 30, "SIMULATOR")]);

    const result = await recommendRoute(START_ID, END_ID, { now: NOW });

    assert.equal(result.fallbackReason, null);
    assert.equal(result.freshnessThresholdSeconds, 45);
    assert.equal(result.evaluatedAt, NOW.toISOString());
    const best = result.recommendedRoute;
    assert.deepEqual(
      Object.keys(best).sort(),
      ["distance", "estimatedTime", "name", "routeId", "status", "trafficLevel", "trafficStatus"].sort()
    );
    assert.equal(best.trafficLevel, "SEVERE", "trafficLevel stays the stored value");
    assert.equal(best.trafficStatus.state, "LIVE");
    assert.equal(best.trafficStatus.level, "MEDIUM");
    assert.match(result.reason, /live measurements/i);
    assert.match(result.reason, /simulated/i);
    assert.match(result.reason, /45 seconds/);
  });

  test("queries the latest bounded readings for the unique waypoints in one aggregation", async () => {
    const pipelines = stubData(
      [
        storedRoute({ routeId: "A", waypoints: [W1, W2] }),
        storedRoute({ routeId: "B", waypoints: [W2, W3] }),
      ],
      []
    );

    await recommendRoute(START_ID, END_ID, { now: NOW });

    assert.equal(pipelines.length, 1);
    const [match, sort, group] = pipelines[0];
    assert.deepEqual(match.$match.location.$in.map(String).sort(), [W1, W2, W3].sort());
    assert.deepEqual(match.$match.measuredAt, {
      $gte: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
      $lte: new Date(NOW.getTime() + 5000),
    });
    assert.deepEqual(match.$match.trafficDensity, { $in: ["LOW", "MEDIUM", "HIGH", "SEVERE"] });
    assert.deepEqual(sort, { $sort: { measuredAt: -1, _id: -1 } });
    assert.equal(group.$group._id, "$location");
  });

  test("a custom freshness threshold is honoured and reported", async () => {
    stubData(twoRoutes(), [reading(W1, "LOW", 50), reading(W2, "LOW", 50)]);

    const strict = await recommendRoute(START_ID, END_ID, { now: NOW, freshnessMs: 45_000 });
    assert.equal(strict.basis, "STATIC_ROUTE_DATA");
    assert.equal(strict.fallbackReason, "NO_FRESH_DATA");

    const relaxed = await recommendRoute(START_ID, END_ID, { now: NOW, freshnessMs: 120_000 });
    assert.equal(relaxed.basis, "LIVE_MEASUREMENTS");
    assert.equal(relaxed.freshnessThresholdSeconds, 120);
  });
});

describe("static fallback is explicit and never presented as live", () => {
  test("routes without waypoints fall back to the stored ranking without querying measurements", async () => {
    const pipelines = stubData(
      [
        storedRoute({ routeId: "HIGH", estimatedTime: 5, trafficLevel: "HIGH" }),
        storedRoute({ routeId: "LOW", estimatedTime: 20, trafficLevel: "LOW" }),
      ],
      []
    );

    const result = await recommendRoute(START_ID, END_ID, { now: NOW });

    assert.equal(pipelines.length, 0);
    assert.equal(result.basis, "STATIC_ROUTE_DATA");
    assert.equal(result.fallbackReason, "NO_WAYPOINTS");
    assert.equal(result.recommendedRoute.routeId, "LOW");
    assert.equal(result.recommendedRoute.trafficStatus.state, "NO_WAYPOINTS");
    assert.match(result.reason, /static route data, not live traffic/i);
    assert.match(result.reason, /stored traffic level \(LOW\)/);
    assert.doesNotMatch(result.reason, /live measurements/i);
  });

  test("stale readings fall back, keep the stored ranking and label the status STALE", async () => {
    stubData(
      [
        storedRoute({ routeId: "A", estimatedTime: 10, trafficLevel: "HIGH", waypoints: [W1] }),
        storedRoute({ routeId: "B", estimatedTime: 20, trafficLevel: "LOW", waypoints: [W2] }),
      ],
      [reading(W1, "LOW", 3600), reading(W2, "SEVERE", 3600)]
    );

    const result = await recommendRoute(START_ID, END_ID, { now: NOW });

    assert.equal(result.basis, "STATIC_ROUTE_DATA");
    assert.equal(result.fallbackReason, "NO_FRESH_DATA");
    assert.equal(result.recommendedRoute.routeId, "B", "stored ranking, not the stale readings");
    assert.equal(result.recommendedRoute.trafficStatus.state, "STALE");
    assert.equal(result.recommendedRoute.trafficStatus.level, null);
    assert.match(result.reason, /static route data, not live traffic/i);
  });

  test("a mix of live and no-waypoint routes is static, and says why", async () => {
    stubData(
      [
        storedRoute({ routeId: "WITH", estimatedTime: 10, trafficLevel: "HIGH", waypoints: [W1] }),
        storedRoute({ routeId: "WITHOUT", estimatedTime: 10, trafficLevel: "LOW" }),
      ],
      [reading(W1, "LOW", 2)]
    );

    const result = await recommendRoute(START_ID, END_ID, { now: NOW });

    assert.equal(result.basis, "STATIC_ROUTE_DATA");
    assert.equal(result.fallbackReason, "NO_WAYPOINTS");
    assert.equal(result.recommendedRoute.routeId, "WITHOUT");
    const withLive = result.alternatives.find((r) => r.routeId === "WITH");
    assert.equal(withLive.trafficStatus.state, "LIVE", "live info is still reported per route");
  });

  test("partial coverage falls back with PARTIAL_DATA", async () => {
    stubData(
      [storedRoute({ routeId: "P", trafficLevel: "MEDIUM", waypoints: [W1, W2] })],
      [reading(W1, "LOW", 2)]
    );

    const result = await recommendRoute(START_ID, END_ID, { now: NOW });

    assert.equal(result.basis, "STATIC_ROUTE_DATA");
    assert.equal(result.fallbackReason, "PARTIAL_DATA");
    assert.equal(result.recommendedRoute.trafficStatus.state, "PARTIAL");
  });
});

describe("controller", () => {
  function mockResponse() {
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

  test("returns the labelled recommendation for a waypoint route", async () => {
    // The controller uses the real clock, so the reading must be relative to now.
    stubData(
      [storedRoute({ routeId: "L", waypoints: [W1] })],
      [{ ...reading(W1, "LOW", 1), measuredAt: new Date(Date.now() - 1000) }]
    );
    const response = mockResponse();

    await getRecommendedRoute({ body: { startLocation: START_ID, endLocation: END_ID } }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.basis, "LIVE_MEASUREMENTS");
    assert.equal(response.body.recommendedRoute.routeId, "L");
  });

  test("a measurement query failure is a 500, not a silent static answer", async () => {
    mock.method(Route, "find", async () => [storedRoute({ waypoints: [W1] })]);
    mock.method(TrafficMeasurement, "aggregate", async () => {
      throw new Error("aggregation failed");
    });
    const response = mockResponse();

    await getRecommendedRoute({ body: { startLocation: START_ID, endLocation: END_ID } }, response);

    assert.equal(response.statusCode, 500);
    assert.equal(response.body.message, "Failed to recommend route");
  });
});
