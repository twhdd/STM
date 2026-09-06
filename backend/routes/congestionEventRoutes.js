const express = require("express");

const {
  runCongestionDetection,
  getCongestionEvents,
  getCongestionEventById,
} = require("../controllers/congestionEventController");

const router = express.Router();

// Run congestion detection for a traffic measurement
router.post("/detect", runCongestionDetection);

// Get all congestion events
router.get("/", getCongestionEvents);

// Get a congestion event by ID
router.get("/:id", getCongestionEventById);

module.exports = router;