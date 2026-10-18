const express = require("express");

const {
  createTrafficLocation,
  getTrafficLocations,
  getTrafficLocationById,
} = require("../controllers/trafficLocationController");

const {
  authenticateToken,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const router = express.Router();

// All routes require a valid token
router.use(authenticateToken);

// Create a traffic location (ADMIN, TRAFFIC_AUTHORITY)
router.post(
  "/",
  authorizeRoles("ADMIN", "TRAFFIC_AUTHORITY"),
  createTrafficLocation
);

// Get all traffic locations (any authenticated user; citizens need them to report and route)
router.get("/", getTrafficLocations);

// Get a traffic location by ID (any authenticated user)
router.get("/:id", getTrafficLocationById);

module.exports = router;
