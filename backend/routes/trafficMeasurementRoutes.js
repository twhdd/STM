const express = require("express");

const {
  createTrafficMeasurement,
  getTrafficMeasurements,
  getTrafficMeasurementById,
} = require("../controllers/trafficMeasurementController");

const {
  authenticateToken,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const router = express.Router();

// All routes require a valid token
router.use(authenticateToken);

// Record a traffic measurement (ADMIN, TRAFFIC_AUTHORITY, TRAFFIC_POLICE)
router.post(
  "/",
  authorizeRoles("ADMIN", "TRAFFIC_AUTHORITY", "TRAFFIC_POLICE"),
  createTrafficMeasurement
);

// Get all traffic measurements (any authenticated user; traffic conditions)
router.get("/", getTrafficMeasurements);

// Get a traffic measurement by ID (any authenticated user)
router.get("/:id", getTrafficMeasurementById);

module.exports = router;
