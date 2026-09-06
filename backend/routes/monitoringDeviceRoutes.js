const express = require("express");

const {
  createMonitoringDevice,
  getMonitoringDevices,
  getMonitoringDeviceById,
} = require("../controllers/monitoringDeviceController");

const router = express.Router();

// Register a monitoring device
router.post("/", createMonitoringDevice);

// Get all monitoring devices
router.get("/", getMonitoringDevices);

// Get a monitoring device by ID
router.get("/:id", getMonitoringDeviceById);

module.exports = router;