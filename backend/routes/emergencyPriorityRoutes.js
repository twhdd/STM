const express = require("express");

const {
  runEmergencyPriority,
} = require("../controllers/emergencyPriorityController");

const router = express.Router();

router.post("/activate", runEmergencyPriority);

module.exports = router;