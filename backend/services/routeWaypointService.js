const Route = require("../models/Route");
const TrafficLocation = require("../models/TrafficLocation");

// A route passes through a handful of monitored junctions; 25 is far above any
// realistic route here and well below the 100-item page cap used elsewhere.
const MAX_WAYPOINTS = 25;
const OBJECT_ID = /^[a-f\d]{24}$/i;
const LOCATION_FIELDS = "name area latitude longitude";

class RouteWaypointError extends Error {
  constructor(statusCode, code, message, details = {}) {
    super(message);
    this.name = "RouteWaypointError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

// Validates the request body and returns the submitted ids, in order, as
// lower-case strings. Nothing is inferred, reordered, deduplicated or generated.
function parseWaypointList(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RouteWaypointError(
      400,
      "INVALID_WAYPOINTS",
      "The request body must be an object with a waypoints array"
    );
  }

  const unexpected = Object.keys(body).filter((key) => key !== "waypoints");
  if (unexpected.length > 0) {
    throw new RouteWaypointError(
      400,
      "UNEXPECTED_FIELDS",
      "Only waypoints can be updated with this endpoint",
      { fields: unexpected }
    );
  }

  if (!Array.isArray(body.waypoints)) {
    throw new RouteWaypointError(
      400,
      "INVALID_WAYPOINTS",
      "waypoints must be an array of traffic location IDs (an empty array clears them)"
    );
  }

  if (body.waypoints.length > MAX_WAYPOINTS) {
    throw new RouteWaypointError(
      400,
      "TOO_MANY_WAYPOINTS",
      `A route can have at most ${MAX_WAYPOINTS} waypoints`,
      { max: MAX_WAYPOINTS }
    );
  }

  const ids = body.waypoints.map((value, index) => {
    if (typeof value !== "string" || !OBJECT_ID.test(value)) {
      throw new RouteWaypointError(
        400,
        "INVALID_WAYPOINT_ID",
        `waypoints[${index}] is not a valid traffic location ID`,
        { index }
      );
    }
    return value.toLowerCase();
  });

  if (new Set(ids).size !== ids.length) {
    throw new RouteWaypointError(
      400,
      "DUPLICATE_WAYPOINTS",
      "waypoints must not contain the same location more than once"
    );
  }

  return ids;
}

// Replaces one route's ordered waypoints. Every id must reference an existing
// traffic location; only the waypoints field is written.
async function updateRouteWaypoints(routeId, body) {
  if (typeof routeId !== "string" || !OBJECT_ID.test(routeId)) {
    throw new RouteWaypointError(400, "INVALID_ID", "Invalid route ID");
  }

  const ids = parseWaypointList(body);

  if (ids.length > 0) {
    const found = await TrafficLocation.find({ _id: { $in: ids } }).select("_id");
    const existing = new Set(found.map((location) => String(location._id)));
    const missing = ids.filter((id) => !existing.has(id));

    if (missing.length > 0) {
      throw new RouteWaypointError(
        400,
        "UNKNOWN_LOCATION",
        "Every waypoint must reference an existing traffic location",
        { missing }
      );
    }
  }

  // An empty list removes the field, returning the route to "no waypoints".
  const update = ids.length > 0 ? { $set: { waypoints: ids } } : { $unset: { waypoints: 1 } };

  const route = await Route.findOneAndUpdate({ _id: routeId }, update, {
    new: true,
    runValidators: true,
  })
    .populate("startLocation", LOCATION_FIELDS)
    .populate("endLocation", LOCATION_FIELDS)
    .populate("waypoints", LOCATION_FIELDS);

  if (!route) {
    throw new RouteWaypointError(404, "ROUTE_NOT_FOUND", "Route not found");
  }

  return route;
}

module.exports = {
  MAX_WAYPOINTS,
  RouteWaypointError,
  updateRouteWaypoints,
};
