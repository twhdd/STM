const express = require("express");

const {
  runCongestionDetection,
  getCongestionEvents,
  getCongestionEventById,
} = require("../controllers/congestionEventController");

const {
  authenticateToken,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const router = express.Router();

// All routes require a valid token
router.use(authenticateToken);

// Run congestion detection for a traffic measurement (ADMIN, TRAFFIC_AUTHORITY)
router.post(
  "/detect",
  authorizeRoles("ADMIN", "TRAFFIC_AUTHORITY"),
  runCongestionDetection
);

// Get all congestion events (any authenticated user)
router.get("/", getCongestionEvents);

// Get a congestion event by ID (any authenticated user)
router.get("/:id", getCongestionEventById);

module.exports = router;
