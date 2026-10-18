const express = require("express");

const {
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

module.exports = router;
