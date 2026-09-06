const express = require("express");

const {
  createTrafficLocation,
  getTrafficLocations,
  getTrafficLocationById,
} = require("../controllers/trafficLocationController");

const router = express.Router();

// Create a traffic location
router.post("/", createTrafficLocation);

// Get all traffic locations
router.get("/", getTrafficLocations);

// Get a traffic location by ID
router.get("/:id", getTrafficLocationById);

module.exports = router;