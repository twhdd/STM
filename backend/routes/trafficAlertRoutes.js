const express = require("express");

const {
  generateCongestionAlert,
  getTrafficAlerts,
  getTrafficAlertById,
} = require("../controllers/trafficAlertController");

const router = express.Router();

// Generate an alert from a congestion event
router.post("/generate", generateCongestionAlert);

// Get all traffic alerts
router.get("/", getTrafficAlerts);

// Get a traffic alert by ID
router.get("/:id", getTrafficAlertById);

module.exports = router;