const express = require("express");

const {
  createEmergencyVehicle,
  getEmergencyVehicles,
  getEmergencyVehicleById,
} = require("../controllers/emergencyVehicleController");

const {
  authenticateToken,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const router = express.Router();

// All routes require a valid token
router.use(authenticateToken);

// Register an emergency vehicle (ADMIN, EMERGENCY_SERVICE)
router.post(
  "/",
  authorizeRoles("ADMIN", "EMERGENCY_SERVICE"),
  createEmergencyVehicle
);

// Vehicle records are operational data: staff roles only
const staffRoles = [
  "ADMIN",
  "TRAFFIC_AUTHORITY",
  "TRAFFIC_POLICE",
  "EMERGENCY_SERVICE",
];

router.get("/", authorizeRoles(...staffRoles), getEmergencyVehicles);
router.get("/:id", authorizeRoles(...staffRoles), getEmergencyVehicleById);

module.exports = router;
