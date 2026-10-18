const express = require("express");

const {
  runSignalOptimization,
} = require("../controllers/signalOptimizationController");

const {
  authenticateToken,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const router = express.Router();

// All routes require a valid token
router.use(authenticateToken);

// Optimize a signal (ADMIN, TRAFFIC_AUTHORITY)
router.post(
  "/optimize",
  authorizeRoles("ADMIN", "TRAFFIC_AUTHORITY"),
  runSignalOptimization
);

module.exports = router;
