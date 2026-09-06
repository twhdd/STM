const express = require("express");

const {
  createTrafficMeasurement,
  getTrafficMeasurements,
  getTrafficMeasurementById,
} = require("../controllers/trafficMeasurementController");

const router = express.Router();

// Record a traffic measurement
router.post("/", createTrafficMeasurement);

// Get all traffic measurements
router.get("/", getTrafficMeasurements);

// Get a traffic measurement by ID
router.get("/:id", getTrafficMeasurementById);

module.exports = router;