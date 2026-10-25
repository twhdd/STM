const TrafficAlert = require("../models/TrafficAlert");
const {
  createCongestionAlert,
} = require("../services/trafficAlertService");
const {
  buildPagination,
  parseEnumFilter,
  parsePagination,
  sendQueryError,
} = require("../utils/pagination");

const ALERT_STATUSES = ["ACTIVE", "RESOLVED"];

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

// Get traffic alerts, newest first, one page at a time
const getTrafficAlerts = async (req, res) => {
  try {
    const paging = parsePagination(req.query);
    const filter = {};
    const status = parseEnumFilter(req.query.status, ALERT_STATUSES, "status");
    if (status) filter.status = status;

    const [total, alerts] = await Promise.all([
      TrafficAlert.countDocuments(filter),
      TrafficAlert.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(paging.skip)
        .limit(paging.limit)
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
        ),
    ]);

    res.status(200).json({
      count: alerts.length,
      pagination: buildPagination(paging, total),
      alerts,
    });
  } catch (error) {
    if (sendQueryError(res, error)) return;

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