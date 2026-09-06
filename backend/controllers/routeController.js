const Route = require("../models/Route");

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

module.exports = {
  createRoute,
  getRoutes,
  getRouteById,
};