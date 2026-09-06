const CongestionEvent = require("../models/CongestionEvent");
const {
  detectCongestion,
} = require("../services/congestionDetectionService");

// Detect congestion from a traffic measurement
const runCongestionDetection = async (req, res) => {
  try {
    const { measurementId } = req.body;

    if (!measurementId) {
      return res.status(400).json({
        message: "measurementId is required",
      });
    }

    const result = await detectCongestion(measurementId);

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      message: "Failed to detect congestion",
      error: error.message,
    });
  }
};

// Get all congestion events
const getCongestionEvents = async (req, res) => {
  try {
    const events = await CongestionEvent.find()
      .populate("location", "name area latitude longitude")
      .populate(
        "measurement",
        "vehicleCount averageSpeed trafficDensity measuredAt"
      );

    res.status(200).json({
      count: events.length,
      events,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch congestion events",
      error: error.message,
    });
  }
};

// Get one congestion event by ID
const getCongestionEventById = async (req, res) => {
  try {
    const event = await CongestionEvent.findById(req.params.id)
      .populate("location", "name area latitude longitude")
      .populate(
        "measurement",
        "vehicleCount averageSpeed trafficDensity measuredAt"
      );

    if (!event) {
      return res.status(404).json({
        message: "Congestion event not found",
      });
    }

    res.status(200).json(event);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch congestion event",
      error: error.message,
    });
  }
};

module.exports = {
  runCongestionDetection,
  getCongestionEvents,
  getCongestionEventById,
};