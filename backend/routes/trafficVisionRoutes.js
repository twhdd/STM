const express = require("express");
const { authenticateToken } = require("../middleware/authMiddleware");
const {
  createJob,
  getJobs,
  getJobStatus,
  getJobResults,
  getAnnotatedVideo,
  downloadResultFile,
} = require("../controllers/trafficVisionController");

const router = express.Router();

// Enforce authentication on all Computer Vision endpoints
router.use(authenticateToken);

// Upload video and create a computer vision processing job
router.post("/jobs", createJob);

// List computer vision processing jobs (scoped to owner for citizens, all for staff)
router.get("/jobs", getJobs);

// Retrieve status and safe metadata for a specific job
router.get("/jobs/:id", getJobStatus);

// Retrieve validated analysis results for a completed job
router.get("/jobs/:id/results", getJobResults);

// Stream or download annotated video with safe headers and range support
router.get("/jobs/:id/annotated-video", getAnnotatedVideo);

// Download JSON analysis results file
router.get("/jobs/:id/result-file", downloadResultFile);

module.exports = router;
