const express = require("express");

const {
  createTrafficSignal,
  getTrafficSignals,
  getTrafficSignalById,
} = require("../controllers/trafficSignalController");

const router = express.Router();

router.post("/", createTrafficSignal);
router.get("/", getTrafficSignals);
router.get("/:id", getTrafficSignalById);

module.exports = router;