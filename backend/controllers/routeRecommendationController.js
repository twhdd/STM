const {
  recommendRoute,
} = require("../services/routeRecommendationService");

// Recommend the best route
const getRecommendedRoute = async (req, res) => {
  try {
    const { startLocation, endLocation } = req.body;

    if (!startLocation || !endLocation) {
      return res.status(400).json({
        message: "startLocation and endLocation are required",
      });
    }

    const result = await recommendRoute(
      startLocation,
      endLocation
    );

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      message: "Failed to recommend route",
      error: error.message,
    });
  }
};

module.exports = {
  getRecommendedRoute,
};