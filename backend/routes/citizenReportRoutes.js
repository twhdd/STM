const express = require("express");

const {
  createCitizenReport,
  getCitizenReports,
  getCitizenReportById,
  updateCitizenReportReview,
} = require("../controllers/citizenReportController");

const {
  authenticateToken,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const router = express.Router();

// All routes require a valid token
router.use(authenticateToken);

// Submit a citizen report (any authenticated user; the controller binds it to the caller)
router.post("/", createCitizenReport);

// Get citizen reports (staff see all; other roles see only their own: enforced in the controller)
router.get("/", getCitizenReports);

// Get a citizen report by ID (same scoping as the list)
router.get("/:id", getCitizenReportById);

// Update review status (ADMIN, TRAFFIC_AUTHORITY, TRAFFIC_POLICE)
router.patch(
  "/:id/review",
  authorizeRoles("ADMIN", "TRAFFIC_AUTHORITY", "TRAFFIC_POLICE"),
  updateCitizenReportReview
);

module.exports = router;
