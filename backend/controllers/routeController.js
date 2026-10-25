const Route = require("../models/Route");
const { updateRouteWaypoints } = require("../services/routeWaypointService");

// Create a route
const createRoute = async (req, res) => {
  try {
    const route = new Route(req.body);
    const savedRoute = await route.save();

    res.status(201).json({
      message: "Route created successfully",
      route: savedRoute,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to create route",
      error: error.message,
    });
  }
};

// Get all routes
const getRoutes = async (req, res) => {
  try {
    const routes = await Route.find()
      .populate(
        "startLocation",
        "name area latitude longitude"
      )
      .populate(
        "endLocation",
        "name area latitude longitude"
      );

    res.status(200).json({
      count: routes.length,
      routes,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch routes",
      error: error.message,
    });
  }
};

// Get route by ID
const getRouteById = async (req, res) => {
  try {
    const route = await Route.findById(req.params.id)
      .populate(
        "startLocation",
        "name area latitude longitude"
      )
      .populate(
        "endLocation",
        "name area latitude longitude"
      );

    if (!route) {
      return res.status(404).json({
        message: "Route not found",
      });
    }

    res.status(200).json(route);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch route",
      error: error.message,
    });
  }
};

// Replace a route's ordered waypoints (ADMIN, TRAFFIC_AUTHORITY via the route)
const updateRouteWaypointList = async (req, res) => {
  try {
    const route = await updateRouteWaypoints(req.params.id, req.body);

    res.status(200).json({
      message: "Route waypoints updated successfully",
      route,
    });
  } catch (error) {
    if (error?.name === "RouteWaypointError") {
      return res.status(error.statusCode).json({
        message: error.message,
        code: error.code,
        ...error.details,
      });
    }

    console.error("Failed to update route waypoints:", error);
    res.status(500).json({
      message: "Failed to update route waypoints",
      code: "INTERNAL_ERROR",
    });
  }
};

module.exports = {
  createRoute,
  getRoutes,
  getRouteById,
  updateRouteWaypointList,
};