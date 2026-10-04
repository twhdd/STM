const CitizenReport = require("../models/CitizenReport");

// Submit a citizen report
const createCitizenReport = async (req, res) => {
  try {
    const {
      reportedBy,
      location,
      reportType,
      description,
      severity,
      status,
      reviewedBy,
      reviewedAt,
    } = req.body;

    if (!reportedBy || !location || !reportType || !description) {
      return res.status(400).json({
        message:
          "reportedBy, location, reportType, and description are required",
      });
    }

    const citizenReport = new CitizenReport({
      reportedBy,
      location,
      reportType,
      description,
      severity,
      status,
      reviewedBy,
      reviewedAt,
    });

    const savedReport = await citizenReport.save();

    res.status(201).json({
      message: "Citizen report submitted successfully",
      report: savedReport,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to submit citizen report",
      error: error.message,
    });
  }
};

// Get all citizen reports
const getCitizenReports = async (req, res) => {
  try {
    const reports = await CitizenReport.find()
      .populate("reportedBy", "fullName email role")
      .populate("location", "name area latitude longitude")
      .populate("reviewedBy", "fullName email role");

    res.status(200).json({
      count: reports.length,
      reports,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch citizen reports",
      error: error.message,
    });
  }
};

// Get one citizen report by ID
const getCitizenReportById = async (req, res) => {
  try {
    const report = await CitizenReport.findById(req.params.id)
      .populate("reportedBy", "fullName email role")
      .populate("location", "name area latitude longitude")
      .populate("reviewedBy", "fullName email role");

    if (!report) {
      return res.status(404).json({
        message: "Citizen report not found",
      });
    }

    res.status(200).json(report);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch citizen report",
      error: error.message,
    });
  }
};

module.exports = {
  createCitizenReport,
  getCitizenReports,
  getCitizenReportById,
};
