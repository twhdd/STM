const {
  getTrafficAnalytics,
} = require("../services/trafficAnalyticsService");

// Get traffic analytics
const getAnalytics = async (req, res) => {
  try {
    const analytics = await getTrafficAnalytics();

    res.status(200).json({
      message: "Traffic analytics generated successfully",
      analytics,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to generate traffic analytics",
      error: error.message,
    });
  }
};

module.exports = {
  getAnalytics,
};