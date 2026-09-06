const TrafficAlert = require("../models/TrafficAlert");
const {
  createCongestionAlert,
} = require("../services/trafficAlertService");

// Create an alert from a congestion event
const generateCongestionAlert = async (req, res) => {
  try {
    const { congestionEventId } = req.body;

    if (!congestionEventId) {
      return res.status(400).json({
        message: "congestionEventId is required",
      });
    }

    const result = await createCongestionAlert(congestionEventId);

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      message: "Failed to create traffic alert",
      error: error.message,
    });
  }
};

// Get all traffic alerts
const getTrafficAlerts = async (req, res) => {
  try {
    const alerts = await TrafficAlert.find()
      .populate(
        "location",
        "name area latitude longitude"
      )
      .populate(
        "congestionEvent",
        "congestionLevel vehicleCount averageSpeed status detectedAt"
      )
      .populate(
        "emergencyVehicle",
        "vehicleId vehicleType registrationNumber status"
      );

    res.status(200).json({
      count: alerts.length,
      alerts,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch traffic alerts",
      error: error.message,
    });
  }
};

// Get a traffic alert by ID
const getTrafficAlertById = async (req, res) => {
  try {
    const alert = await TrafficAlert.findById(req.params.id)
      .populate(
        "location",
        "name area latitude longitude"
      )
      .populate(
        "congestionEvent",
        "congestionLevel vehicleCount averageSpeed status detectedAt"
      )
      .populate(
        "emergencyVehicle",
        "vehicleId vehicleType registrationNumber status"
      );

    if (!alert) {
      return res.status(404).json({
        message: "Traffic alert not found",
      });
    }

    res.status(200).json(alert);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch traffic alert",
      error: error.message,
    });
  }
};

module.exports = {
  generateCongestionAlert,
  getTrafficAlerts,
  getTrafficAlertById,
};