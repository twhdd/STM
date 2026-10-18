const express = require("express");

const {
  getAnalytics,
} = require("../controllers/trafficAnalyticsController");

const { authenticateToken } = require("../middleware/authMiddleware");

const router = express.Router();

// All routes require a valid token
router.use(authenticateToken);

// Get traffic analytics (any authenticated user; aggregate figures only)
router.get("/", getAnalytics);

module.exports = router;
