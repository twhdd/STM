const TrafficSignal = require("../models/TrafficSignal");
const TrafficLocation = require("../models/TrafficLocation");

// Create a traffic signal
const createTrafficSignal = async (req, res) => {
  try {
    const signal = new TrafficSignal(req.body);
    const savedSignal = await signal.save();

    res.status(201).json({
      message: "Traffic signal created successfully",
      signal: savedSignal,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to create traffic signal",
      error: error.message,
    });
  }
};

// Get all traffic signals
const getTrafficSignals = async (req, res) => {
  try {
    const signals = await TrafficSignal.find().populate(
      "location",
      "name area latitude longitude"
    );

    res.status(200).json({
      count: signals.length,
      signals,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch traffic signals",
      error: error.message,
    });
  }
};

// Get traffic signal by ID
const getTrafficSignalById = async (req, res) => {
  try {
    const signal = await TrafficSignal.findById(req.params.id).populate(
      "location",
      "name area latitude longitude"
    );

    if (!signal) {
      return res.status(404).json({
        message: "Traffic signal not found",
      });
    }

    res.status(200).json(signal);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch traffic signal",
      error: error.message,
    });
  }
};

module.exports = {
  createTrafficSignal,
  getTrafficSignals,
  getTrafficSignalById,
};