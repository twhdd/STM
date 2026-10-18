const express = require("express");

const {
  getRecommendedRoute,
} = require("../controllers/routeRecommendationController");

const { authenticateToken } = require("../middleware/authMiddleware");

const router = express.Router();

// All routes require a valid token
router.use(authenticateToken);

// Recommend a route: read-only computation, any authenticated user
router.post("/recommend", getRecommendedRoute);

module.exports = router;
