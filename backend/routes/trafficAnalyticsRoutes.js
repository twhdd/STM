const express = require("express");

const {
  getAnalytics,
} = require("../controllers/trafficAnalyticsController");

const router = express.Router();

// Get traffic analytics
router.get("/", getAnalytics);

module.exports = router;