const mongoose = require("mongoose");
const TrafficMeasurement = require("../models/TrafficMeasurement");

const DENSITY_SCORE = Object.freeze({ LOW: 1, MEDIUM: 2, HIGH: 3, SEVERE: 4 });
const DENSITY_LEVELS = Object.keys(DENSITY_SCORE);

// Readings stamped this far ahead of the server clock are rejected; smaller
// skews are treated as age zero.
const FUTURE_TOLERANCE_MS = 5000;
// Only readings from the last 24 h are fetched, which bounds the aggregation.
// Anything older is reported as no data rather than as a stale level.
const LOOKBACK_MS = 24 * 60 * 60 * 1000;
// Fresh readings this many levels apart (for example LOW and HIGH) are flagged.
const CONFLICT_GAP = 2;

function classifyObservation(observation, now, freshnessMs) {
  if (!observation) return { state: "MISSING" };

  const level = observation.trafficDensity;
  const observedAt = new Date(observation.measuredAt);

  if (
    !Object.hasOwn(DENSITY_SCORE, level) ||
    observation.measuredAt == null ||
    Number.isNaN(observedAt.getTime())
  ) {
    return { state: "INVALID" };
  }

  const rawAgeMs = now.getTime() - observedAt.getTime();
  if (rawAgeMs < -FUTURE_TOLERANCE_MS) return { state: "INVALID" };

  const ageMs = Math.max(0, rawAgeMs);
  return {
    state: ageMs <= freshnessMs ? "FRESH" : "STALE",
    level,
    observedAt,
    ageMs,
    source: observation.source || "UNKNOWN",
  };
}

// Route state: LIVE (every waypoint fresh), PARTIAL (some fresh), STALE (only
// old readings), NO_DATA (nothing usable) or NO_WAYPOINTS. A level is only
// reported from fresh readings, and the worst fresh reading wins.
function summarizeRouteTraffic(route, observations, now, freshnessMs) {
  const waypointIds = [...new Set((route.waypoints || []).map(String))];

  if (waypointIds.length === 0) {
    return {
      state: "NO_WAYPOINTS",
      level: null,
      coverage: { fresh: 0, total: 0 },
      conflicting: false,
      limitingWaypoint: null,
      dataAsOf: null,
      ageSeconds: null,
      lastObservedAt: null,
      sources: [],
    };
  }

  const classified = waypointIds.map((id) => ({
    id,
    ...classifyObservation(observations.get(id), now, freshnessMs),
  }));
  const fresh = classified.filter((item) => item.state === "FRESH");
  const stale = classified.filter((item) => item.state === "STALE");

  let state = "NO_DATA";
  if (fresh.length === waypointIds.length) state = "LIVE";
  else if (fresh.length > 0) state = "PARTIAL";
  else if (stale.length > 0) state = "STALE";

  let level = null;
  let limitingWaypoint = null;
  let conflicting = false;
  let dataAsOf = null;
  let ageSeconds = null;

  if (fresh.length > 0) {
    let worst = fresh[0];
    let best = fresh[0];
    for (const item of fresh) {
      if (DENSITY_SCORE[item.level] > DENSITY_SCORE[worst.level]) worst = item;
      if (DENSITY_SCORE[item.level] < DENSITY_SCORE[best.level]) best = item;
    }
    level = worst.level;
    limitingWaypoint = worst.id;
    conflicting =
      fresh.length >= 2 &&
      DENSITY_SCORE[worst.level] - DENSITY_SCORE[best.level] >= CONFLICT_GAP;

    const oldest = fresh.reduce((a, b) => (b.ageMs > a.ageMs ? b : a));
    dataAsOf = oldest.observedAt.toISOString();
    ageSeconds = Math.round(oldest.ageMs / 1000);
  }

  const lastObservedAt =
    state === "STALE"
      ? new Date(Math.max(...stale.map((item) => item.observedAt.getTime()))).toISOString()
      : null;

  return {
    state,
    level,
    coverage: { fresh: fresh.length, total: waypointIds.length },
    conflicting,
    limitingWaypoint,
    dataAsOf,
    ageSeconds,
    lastObservedAt,
    sources: [...new Set(fresh.map((item) => item.source))].sort(),
  };
}

// Live ranking is only used when every candidate route is LIVE; mixing live
// and stored values in one ranking would compare unlike things.
function selectBasis(statuses) {
  if (statuses.every((status) => status.state === "LIVE")) {
    return { basis: "LIVE_MEASUREMENTS", fallbackReason: null };
  }

  const states = new Set(statuses.map((status) => status.state));
  let fallbackReason = "PARTIAL_DATA";
  if (states.has("NO_WAYPOINTS")) fallbackReason = "NO_WAYPOINTS";
  else if (states.has("STALE") || states.has("NO_DATA")) fallbackReason = "NO_FRESH_DATA";

  return { basis: "STATIC_ROUTE_DATA", fallbackReason };
}

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const scoreOf = (level) => DENSITY_SCORE[level] ?? Number.MAX_SAFE_INTEGER;

function rankRoutes(entries, basis) {
  const level =
    basis === "LIVE_MEASUREMENTS"
      ? (entry) => entry.status.level
      : (entry) => entry.route.trafficLevel;

  return [...entries].sort(
    (a, b) =>
      scoreOf(level(a)) - scoreOf(level(b)) ||
      a.route.estimatedTime - b.route.estimatedTime ||
      a.route.distance - b.route.distance ||
      compareText(String(a.route.routeId), String(b.route.routeId))
  );
}

async function loadLatestObservations(locationIds, now) {
  if (locationIds.length === 0) return new Map();

  const rows = await TrafficMeasurement.aggregate([
    {
      $match: {
        location: { $in: locationIds.map((id) => new mongoose.Types.ObjectId(id)) },
        measuredAt: {
          $gte: new Date(now.getTime() - LOOKBACK_MS),
          $lte: new Date(now.getTime() + FUTURE_TOLERANCE_MS),
        },
        trafficDensity: { $in: DENSITY_LEVELS },
      },
    },
    { $sort: { measuredAt: -1, _id: -1 } },
    {
      $group: {
        _id: "$location",
        measuredAt: { $first: "$measuredAt" },
        trafficDensity: { $first: "$trafficDensity" },
        source: { $first: "$source" },
      },
    },
  ]);

  return new Map(rows.map((row) => [String(row._id), row]));
}

module.exports = {
  DENSITY_SCORE,
  classifyObservation,
  loadLatestObservations,
  rankRoutes,
  selectBasis,
  summarizeRouteTraffic,
};
