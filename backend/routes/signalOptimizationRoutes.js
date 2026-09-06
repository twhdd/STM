const express = require("express");

const {
  runSignalOptimization,
} = require("../controllers/signalOptimizationController");

const router = express.Router();

router.post("/optimize", runSignalOptimization);

module.exports = router;