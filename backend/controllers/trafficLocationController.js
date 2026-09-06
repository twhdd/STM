const TrafficLocation = require("../models/TrafficLocation");

// Create a new traffic location
const createTrafficLocation = async (req, res) => {
  try {
    const { name, latitude, longitude, area, status } = req.body;

    const trafficLocation = new TrafficLocation({
      name,
      latitude,
      longitude,
      area,
      status,
    });

    const savedLocation = await trafficLocation.save();

    res.status(201).json({
      message: "Traffic location created successfully",
      location: savedLocation,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to create traffic location",
      error: error.message,
    });
  }
};

// Get all traffic locations
const getTrafficLocations = async (req, res) => {
  try {
    const locations = await TrafficLocation.find();

    res.status(200).json({
      count: locations.length,
      locations,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch traffic locations",
      error: error.message,
    });
  }
};

// Get one traffic location by ID
const getTrafficLocationById = async (req, res) => {
  try {
    const location = await TrafficLocation.findById(req.params.id);

    if (!location) {
      return res.status(404).json({
        message: "Traffic location not found",
      });
    }

    res.status(200).json(location);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch traffic location",
      error: error.message,
    });
  }
};

module.exports = {
  createTrafficLocation,
  getTrafficLocations,
  getTrafficLocationById,
};