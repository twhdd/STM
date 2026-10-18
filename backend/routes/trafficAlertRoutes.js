const express = require("express");

const {
  generateCongestionAlert,
  getTrafficAlerts,
  getTrafficAlertById,
} = require("../controllers/trafficAlertController");

const {
  authenticateToken,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const router = express.Router();

// All routes require a valid token
router.use(authenticateToken);

// Generate an alert from a congestion event (ADMIN, TRAFFIC_AUTHORITY)
router.post(
  "/generate",
  authorizeRoles("ADMIN", "TRAFFIC_AUTHORITY"),
  generateCongestionAlert
);

// Get all traffic alerts (any authenticated user; citizens receive alerts)
router.get("/", getTrafficAlerts);

// Get a traffic alert by ID (any authenticated user)
router.get("/:id", getTrafficAlertById);

module.exports = router;
