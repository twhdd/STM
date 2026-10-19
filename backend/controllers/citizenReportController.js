
const CitizenReport = require("../models/CitizenReport");
const mongoose = require("mongoose");

// Roles that may view every report and review report statuses.
const REVIEWER_ROLES = [
  "ADMIN",
  "TRAFFIC_AUTHORITY",
  "TRAFFIC_POLICE",
];

// Roles that may view every report but cannot review statuses.
const ALL_REPORTS_READ_ROLES = [
  ...REVIEWER_ROLES,
  "EMERGENCY_SERVICE",
];

const REPORT_STATUS_TRANSITIONS = Object.freeze({
  SUBMITTED: ["UNDER_REVIEW"],
  UNDER_REVIEW: ["VERIFIED", "RESOLVED", "REJECTED"],
  VERIFIED: ["RESOLVED", "REJECTED"],
  REJECTED: [],
  RESOLVED: [],
});

const isReviewer = (req) =>
  REVIEWER_ROLES.includes(req.user.role);

const canViewAllReports = (req) =>
  ALL_REPORTS_READ_ROLES.includes(req.user.role);

const reportForResponse = (report, reviewer) => {
  const result = report?.toObject
    ? report.toObject()
    : { ...report };

  // Hide internal user/reviewer metadata from non-reviewers.
  if (!reviewer) {
    delete result.reportedBy;
    delete result.reviewedBy;
    delete result.reviewedAt;
  }

  return result;
};

// Submit a citizen report.
const createCitizenReport = async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({
        message: "location, reportType, and description are required",
      });
    }

    const {
      location,
      reportType,
      description,
      severity,
    } = body;

    // Reports belong to the authenticated caller.
    // Only ADMIN may submit on behalf of another user.
    const reportedBy = body.reportedBy || req.user.userId;

    if (
      String(reportedBy) !== String(req.user.userId) &&
      req.user.role !== "ADMIN"
    ) {
      return res.status(403).json({
        message:
          "You cannot submit a report on behalf of another user",
      });
    }

    if (!location || !reportType || !description) {
      return res.status(400).json({
        message:
          "location, reportType, and description are required",
      });
    }

    if (
      typeof location !== "string" ||
      !mongoose.isValidObjectId(location)
    ) {
      return res.status(400).json({
        message: "location must be a valid traffic location ID",
      });
    }

    const validReportTypes =
      CitizenReport.schema.path("reportType").enumValues;
    if (
      typeof reportType !== "string" ||
      !validReportTypes.includes(reportType)
    ) {
      return res.status(400).json({
        message: `reportType must be one of: ${validReportTypes.join(", ")}`,
      });
    }

    if (typeof description !== "string" || !description.trim()) {
      return res.status(400).json({
        message: "description must not be empty",
      });
    }

    const validSeverities = CitizenReport.schema.path("severity").enumValues;
    if (severity !== undefined && !validSeverities.includes(severity)) {
      return res.status(400).json({
        message: `severity must be one of: ${validSeverities.join(", ")}`,
      });
    }

    if (
      typeof reportedBy !== "string" ||
      !mongoose.isValidObjectId(reportedBy)
    ) {
      return res.status(400).json({
        message: "reportedBy must be a valid user ID",
      });
    }

    const citizenReport = new CitizenReport({
      reportedBy,
      location,
      reportType,
      description,
      severity,
    });

    const savedReport = await citizenReport.save();

    return res.status(201).json({
      message: "Citizen report submitted successfully",
      report: savedReport,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to submit citizen report",
      error: error.message,
    });
  }
};

// Get reports visible to the authenticated user.
// Reviewers and Emergency Service see all reports.
// Other roles see only their own reports.
const getCitizenReports = async (req, res) => {
  try {
    const canViewAll = canViewAllReports(req);
    const reviewer = isReviewer(req);

    const filter = canViewAll
      ? {}
      : { reportedBy: req.user.userId };

    let query = CitizenReport.find(filter).populate(
      "location",
      "name area latitude longitude"
    );

    if (reviewer) {
      query = query
        .populate("reportedBy", "fullName email role")
        .populate("reviewedBy", "fullName email role");
    } else {
      query = query.select(
        "-reportedBy -reviewedBy -reviewedAt"
      );
    }

    const reports = await query;

    return res.status(200).json({
      count: reports.length,
      reports: reports.map((report) =>
        reportForResponse(report, reviewer)
      ),
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch citizen reports",
      error: error.message,
    });
  }
};

// Get one citizen report by ID.
// Reviewers and Emergency Service may view any report.
// Other roles may view only their own reports.
const getCitizenReportById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        message: "Invalid citizen report ID",
      });
    }

    const reviewer = isReviewer(req);
    const canViewAll = canViewAllReports(req);

    let query = CitizenReport.findById(req.params.id).populate(
      "location",
      "name area latitude longitude"
    );

    if (reviewer) {
      query = query
        .populate("reportedBy", "fullName email role")
        .populate("reviewedBy", "fullName email role");
    } else {
      query = query.select(
        "-reportedBy -reviewedBy -reviewedAt"
      );
    }

    const report = await query;

    // Resolve ownership before removing owner metadata from the response.
    const ownerId =
      report && (report.reportedBy?._id || report.reportedBy);

    if (
      !report ||
      (!canViewAll &&
        String(ownerId) !== String(req.user.userId))
    ) {
      // Return 404 rather than revealing another user's report exists.
      return res.status(404).json({
        message: "Citizen report not found",
      });
    }

    return res.status(200).json(
      reportForResponse(report, reviewer)
    );
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch citizen report",
      error: error.message,
    });
  }
};

// Update a report's review status.
// The route must enforce reviewer-role authorization middleware.
const updateCitizenReportReview = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({
      message: "Invalid citizen report ID",
    });
  }

  const body = req.body;

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== "status") ||
    typeof body.status !== "string" ||
    !body.status.trim()
  ) {
    return res.status(400).json({
      message:
        "A status is required and no other review fields may be supplied",
    });
  }

  const validStatuses =
    CitizenReport.schema.path("status").enumValues;

  if (!validStatuses.includes(body.status)) {
    return res.status(400).json({
      message: `status must be one of: ${validStatuses.join(", ")}`,
    });
  }

  try {
    // Defense in depth: only designated reviewers may update statuses.
    if (!isReviewer(req)) {
      return res.status(403).json({
        message: "You are not authorized to review citizen reports",
      });
    }

    const report = await CitizenReport.findById(req.params.id);

    if (!report) {
      return res.status(404).json({
        message: "Citizen report not found",
      });
    }

    const allowedNextStatuses =
      REPORT_STATUS_TRANSITIONS[report.status] || [];

    if (!allowedNextStatuses.includes(body.status)) {
      return res.status(409).json({
        message:
          `A report with status ${report.status} cannot transition to ${body.status}`,
      });
    }

    report.status = body.status;
    report.reviewedBy = req.user.userId;
    report.reviewedAt = new Date();

    const savedReport = await report.save();

    return res.status(200).json({
      message: "Citizen report review updated successfully",
      report: savedReport,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to update citizen report review",
      error: error.message,
    });
  }
};

module.exports = {
  createCitizenReport,
  getCitizenReports,
  getCitizenReportById,
  updateCitizenReportReview,
  REPORT_STATUS_TRANSITIONS,
  REVIEWER_ROLES,
};
