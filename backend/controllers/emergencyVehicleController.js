const EmergencyVehicle = require("../models/EmergencyVehicle");

// Register an emergency vehicle
const createEmergencyVehicle = async (req, res) => {
  try {
    const vehicle = new EmergencyVehicle(req.body);
    const savedVehicle = await vehicle.save();

    res.status(201).json({
      message: "Emergency vehicle registered successfully",
      vehicle: savedVehicle,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to register emergency vehicle",
      error: error.message,
    });
  }
};

// Get all emergency vehicles
const getEmergencyVehicles = async (req, res) => {
  try {
    const vehicles = await EmergencyVehicle.find().populate(
      "currentLocation",
      "name area latitude longitude"
    );

    res.status(200).json({
      count: vehicles.length,
      vehicles,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch emergency vehicles",
      error: error.message,
    });
  }
};

// Get emergency vehicle by ID
const getEmergencyVehicleById = async (req, res) => {
  try {
    const vehicle = await EmergencyVehicle.findById(
      req.params.id
    ).populate(
      "currentLocation",
      "name area latitude longitude"
    );

    if (!vehicle) {
      return res.status(404).json({
        message: "Emergency vehicle not found",
      });
    }

    res.status(200).json(vehicle);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch emergency vehicle",
      error: error.message,
    });
  }
};

module.exports = {
  createEmergencyVehicle,
  getEmergencyVehicles,
  getEmergencyVehicleById,
};