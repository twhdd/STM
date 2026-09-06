const express = require("express");

const {
  createEmergencyVehicle,
  getEmergencyVehicles,
  getEmergencyVehicleById,
} = require("../controllers/emergencyVehicleController");

const router = express.Router();

router.post("/", createEmergencyVehicle);
router.get("/", getEmergencyVehicles);
router.get("/:id", getEmergencyVehicleById);

module.exports = router;