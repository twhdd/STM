const express = require("express");

const {
  createMonitoringDevice,
  getMonitoringDevices,
  getMonitoringDeviceById,
} = require("../controllers/monitoringDeviceController");

const {
  authenticateToken,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const router = express.Router();

// All routes require a valid token
router.use(authenticateToken);

// Register a monitoring device (ADMIN, TRAFFIC_AUTHORITY)
router.post(
  "/",
  authorizeRoles("ADMIN", "TRAFFIC_AUTHORITY"),
  createMonitoringDevice
);

// Device inventory is infrastructure data: staff roles only
const staffRoles = [
  "ADMIN",
  "TRAFFIC_AUTHORITY",
  "TRAFFIC_POLICE",
  "EMERGENCY_SERVICE",
];

// Get all monitoring devices (staff)
router.get("/", authorizeRoles(...staffRoles), getMonitoringDevices);

// Get a monitoring device by ID (staff)
router.get("/:id", authorizeRoles(...staffRoles), getMonitoringDeviceById);

module.exports = router;
