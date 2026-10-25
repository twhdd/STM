const CongestionEvent = require("../models/CongestionEvent");
const {
  detectCongestion,
} = require("../services/congestionDetectionService");
const {
  buildPagination,
  parseEnumFilter,
  parsePagination,
  sendQueryError,
} = require("../utils/pagination");

const EVENT_STATUSES = ["ACTIVE", "RESOLVED"];

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

// Get congestion events, newest first, one page at a time
const getCongestionEvents = async (req, res) => {
  try {
    const paging = parsePagination(req.query);
    const filter = {};
    const status = parseEnumFilter(req.query.status, EVENT_STATUSES, "status");
    if (status) filter.status = status;

    const [total, events] = await Promise.all([
      CongestionEvent.countDocuments(filter),
      CongestionEvent.find(filter)
        .sort({ detectedAt: -1, _id: -1 })
        .skip(paging.skip)
        .limit(paging.limit)
        .populate("location", "name area latitude longitude")
        .populate(
          "measurement",
          "vehicleCount averageSpeed trafficDensity measuredAt"
        ),
    ]);

    res.status(200).json({
      count: events.length,
      pagination: buildPagination(paging, total),
      events,
    });
  } catch (error) {
    if (sendQueryError(res, error)) return;

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