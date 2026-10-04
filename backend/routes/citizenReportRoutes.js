const express = require("express");

const {
  createCitizenReport,
  getCitizenReports,
  getCitizenReportById,
} = require("../controllers/citizenReportController");

const router = express.Router();

// Submit a citizen report
router.post("/", createCitizenReport);

// Get all citizen reports
router.get("/", getCitizenReports);

// Get a citizen report by ID
router.get("/:id", getCitizenReportById);

module.exports = router;
