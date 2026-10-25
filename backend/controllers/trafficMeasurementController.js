const TrafficMeasurement = require("../models/TrafficMeasurement");
const MonitoringDevice = require("../models/MonitoringDevice");
const TrafficLocation = require("../models/TrafficLocation");
const trafficMeasurementIngestionService = require("../services/trafficMeasurementIngestionService");
const {
  buildPagination,
  parseObjectIdFilter,
  parsePagination,
  sendQueryError,
} = require("../utils/pagination");

// Create a new traffic measurement
const createTrafficMeasurement = async (req, res) => {
  try {
    const {
      device,
      location,
      vehicleCount,
      averageSpeed,
      trafficDensity,
      measuredAt,
    } = req.body;

    const { measurement: savedMeasurement, processing } =
      await trafficMeasurementIngestionService.recordTrafficMeasurement({
        device,
        location,
        vehicleCount,
        averageSpeed,
        trafficDensity,
        measuredAt,
      });

    res.status(201).json({
      message: "Traffic measurement recorded successfully",
      measurement: savedMeasurement,
      processing,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to record traffic measurement",
      error: error.message,
    });
  }
};

// Get traffic measurements, newest first, one page at a time
const getTrafficMeasurements = async (req, res) => {
  try {
    const paging = parsePagination(req.query);
    const filter = {};
    const location = parseObjectIdFilter(req.query.location, "location");
    if (location) filter.location = location;

    const [total, measurements] = await Promise.all([
      TrafficMeasurement.countDocuments(filter),
      TrafficMeasurement.find(filter)
        .sort({ measuredAt: -1, _id: -1 })
        .skip(paging.skip)
        .limit(paging.limit)
        .populate("device", "deviceId deviceType name status")
        .populate("location", "name area latitude longitude"),
    ]);

    res.status(200).json({
      count: measurements.length,
      pagination: buildPagination(paging, total),
      measurements,
    });
  } catch (error) {
    if (sendQueryError(res, error)) return;

    res.status(500).json({
      message: "Failed to fetch traffic measurements",
      error: error.message,
    });
  }
};

// Get one traffic measurement by ID
const getTrafficMeasurementById = async (req, res) => {
  try {
    const measurement = await TrafficMeasurement.findById(req.params.id)
      .populate("device", "deviceId deviceType name status")
      .populate("location", "name area latitude longitude");

    if (!measurement) {
      return res.status(404).json({
        message: "Traffic measurement not found",
      });
    }

    res.status(200).json(measurement);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch traffic measurement",
      error: error.message,
    });
  }
};

module.exports = {
  createTrafficMeasurement,
  getTrafficMeasurements,
  getTrafficMeasurementById,
};