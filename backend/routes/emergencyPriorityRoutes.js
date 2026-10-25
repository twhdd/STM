const express = require("express");

const {
  runEmergencyDeactivation,
  runEmergencyPriority,
} = require("../controllers/emergencyPriorityController");

const {
  authenticateToken,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const router = express.Router();

// All routes require a valid token
router.use(authenticateToken);

// Activate emergency priority (ADMIN, EMERGENCY_SERVICE)
router.post(
  "/activate",
  authorizeRoles("ADMIN", "EMERGENCY_SERVICE"),
  runEmergencyPriority
);

// Deactivate emergency priority and restore the signal (ADMIN, EMERGENCY_SERVICE)
router.post(
  "/deactivate",
  authorizeRoles("ADMIN", "EMERGENCY_SERVICE"),
  runEmergencyDeactivation
);

module.exports = router;
