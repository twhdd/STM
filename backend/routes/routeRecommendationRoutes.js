const express = require("express");

const {
  getRecommendedRoute,
} = require("../controllers/routeRecommendationController");

const router = express.Router();

router.post("/recommend", getRecommendedRoute);

module.exports = router;