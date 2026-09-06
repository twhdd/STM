const TrafficMeasurement = require("../models/TrafficMeasurement");
const MonitoringDevice = require("../models/MonitoringDevice");
const TrafficLocation = require("../models/TrafficLocation");

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

    const measurement = new TrafficMeasurement({
      device,
      location,
      vehicleCount,
      averageSpeed,
      trafficDensity,
      measuredAt,
    });

    const savedMeasurement = await measurement.save();

    res.status(201).json({
      message: "Traffic measurement recorded successfully",
      measurement: savedMeasurement,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to record traffic measurement",
      error: error.message,
    });
  }
};

// Get all traffic measurements
const getTrafficMeasurements = async (req, res) => {
  try {
    const measurements = await TrafficMeasurement.find()
      .populate("device", "deviceId deviceType name status")
      .populate("location", "name area latitude longitude");

    res.status(200).json({
      count: measurements.length,
      measurements,
    });
  } catch (error) {
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