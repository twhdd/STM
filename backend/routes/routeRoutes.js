const express = require("express");

const {
  createRoute,
  getRoutes,
  getRouteById,
} = require("../controllers/routeController");

const {
  authenticateToken,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const router = express.Router();

// All routes require a valid token
router.use(authenticateToken);

// Create a route (ADMIN, TRAFFIC_AUTHORITY)
router.post("/", authorizeRoles("ADMIN", "TRAFFIC_AUTHORITY"), createRoute);

// Read routes (any authenticated user)
router.get("/", getRoutes);
router.get("/:id", getRouteById);

module.exports = router;
