const mongoose = require("mongoose");
const Route = require("../models/Route");
const { loadRouteTrafficConfig } = require("../config/routeTraffic");
const {
  loadLatestObservations,
  rankRoutes,
  selectBasis,
  summarizeRouteTraffic,
} = require("./routeTrafficService");

const routeTrafficConfig = loadRouteTrafficConfig();

function createRecommendationError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

const FALLBACK_TEXT = Object.freeze({
  NO_WAYPOINTS: "at least one route option has no monitored waypoints",
  NO_FRESH_DATA: "at least one route option has no fresh measurements at its waypoints",
  PARTIAL_DATA: "measurements cover only some waypoints of at least one route option",
});

function buildReason({ basis, fallbackReason }, best, freshnessMs) {
  if (basis === "LIVE_MEASUREMENTS") {
    const { level, coverage, sources, conflicting } = best.status;
    let reason =
      `Recommended using live measurements: ${level.toLowerCase()} traffic along ` +
      `${coverage.total} monitored waypoint(s), readings no older than ${freshnessMs / 1000} seconds`;
    if (sources.includes("SIMULATOR")) reason += " (simulated measurements)";
    reason += `. Stored time estimate: ${best.route.estimatedTime} minutes.`;
    if (conflicting) {
      reason += " Readings along the route conflict; the worst reading was used.";
    }
    return reason;
  }

  return (
    `Static route data, not live traffic (${FALLBACK_TEXT[fallbackReason]}): ` +
    `recommended using the stored traffic level (${best.route.trafficLevel}) and ` +
    `stored time estimate (${best.route.estimatedTime} minutes).`
  );
}

const presentRoute = ({ route, status }) => ({
  routeId: route.routeId,
  name: route.name,
  distance: route.distance,
  estimatedTime: route.estimatedTime,
  trafficLevel: route.trafficLevel,
  status: route.status,
  trafficStatus: status,
});

// Recommend the best route between two locations. Routes are ranked on live
// measurements at their waypoints only when every option has fresh data at all
// of its waypoints; otherwise the stored route data is used and labelled static.
const recommendRoute = async (startLocation, endLocation, options = {}) => {
  if (
    typeof startLocation !== "string" ||
    !mongoose.isValidObjectId(startLocation) ||
    typeof endLocation !== "string" ||
    !mongoose.isValidObjectId(endLocation)
  ) {
    throw createRecommendationError(
      "startLocation and endLocation must be valid location IDs",
      400
    );
  }

  const routes = await Route.find({
    startLocation,
    endLocation,
    status: { $ne: "BLOCKED" },
  });

  if (routes.length === 0) {
    throw createRecommendationError("No available routes found", 404);
  }

  const now = options.now ?? new Date();
  const freshnessMs = options.freshnessMs ?? routeTrafficConfig.freshnessMs;

  const waypointIds = [
    ...new Set(routes.flatMap((route) => (route.waypoints || []).map(String))),
  ];
  const observations = await loadLatestObservations(waypointIds, now);

  const entries = routes.map((route) => ({
    route,
    status: summarizeRouteTraffic(route, observations, now, freshnessMs),
  }));
  const selection = selectBasis(entries.map((entry) => entry.status));
  const [best, ...rest] = rankRoutes(entries, selection.basis);

  return {
    recommendedRoute: presentRoute(best),
    alternatives: rest.map(presentRoute),
    basis: selection.basis,
    fallbackReason: selection.fallbackReason,
    freshnessThresholdSeconds: freshnessMs / 1000,
    evaluatedAt: now.toISOString(),
    reason: buildReason(selection, best, freshnessMs),
  };
};

module.exports = {
  recommendRoute,
};
