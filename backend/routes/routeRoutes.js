const express = require("express");

const {
  createRoute,
  getRoutes,
  getRouteById,
} = require("../controllers/routeController");

const router = express.Router();

router.post("/", createRoute);
router.get("/", getRoutes);
router.get("/:id", getRouteById);

module.exports = router;