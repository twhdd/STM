const express = require("express");

const {
  createTrafficSignal,
  getTrafficSignals,
  getTrafficSignalById,
} = require("../controllers/trafficSignalController");

const {
  authenticateToken,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const router = express.Router();

// All routes require a valid token
router.use(authenticateToken);

// Create a traffic signal (ADMIN, TRAFFIC_AUTHORITY)
router.post(
  "/",
  authorizeRoles("ADMIN", "TRAFFIC_AUTHORITY"),
  createTrafficSignal
);

// Signal configuration is operational data: staff roles only
const staffRoles = [
  "ADMIN",
  "TRAFFIC_AUTHORITY",
  "TRAFFIC_POLICE",
  "EMERGENCY_SERVICE",
];

router.get("/", authorizeRoles(...staffRoles), getTrafficSignals);
router.get("/:id", authorizeRoles(...staffRoles), getTrafficSignalById);

module.exports = router;
