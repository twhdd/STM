const express = require("express");
const cors = require("cors");
require("dotenv").config();

const connectDB = require("./config/database");
const authRoutes = require("./routes/authRoutes");
const trafficLocationRoutes = require("./routes/trafficLocationRoutes");
const monitoringDeviceRoutes = require("./routes/monitoringDeviceRoutes");
const trafficMeasurementRoutes = require("./routes/trafficMeasurementRoutes");
const trafficSignalRoutes = require("./routes/trafficSignalRoutes");
const signalOptimizationRoutes = require("./routes/signalOptimizationRoutes");
const emergencyVehicleRoutes = require("./routes/emergencyVehicleRoutes");
const emergencyPriorityRoutes = require("./routes/emergencyPriorityRoutes");
const routeRoutes = require("./routes/routeRoutes");
const routeRecommendationRoutes = require("./routes/routeRecommendationRoutes");
const trafficAlertRoutes = require("./routes/trafficAlertRoutes");
const trafficAnalyticsRoutes = require("./routes/trafficAnalyticsRoutes");
const congestionEventRoutes = require("./routes/congestionEventRoutes");
const citizenReportRoutes = require("./routes/citizenReportRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Authentication routes
app.use("/api/auth", authRoutes);

// Traffic location routes
app.use("/api/traffic-locations", trafficLocationRoutes);

// Monitoring device routes
app.use("/api/monitoring-devices", monitoringDeviceRoutes);

// Traffic measurement routes
app.use("/api/traffic-measurements", trafficMeasurementRoutes);

// Traffic signal routes
app.use("/api/traffic-signals", trafficSignalRoutes);

// Signal optimization routes
app.use("/api/signal-optimization", signalOptimizationRoutes);

// Emergency vehicle routes
app.use("/api/emergency-vehicles", emergencyVehicleRoutes);

// Emergency priority routes
app.use("/api/emergency-priority", emergencyPriorityRoutes);

// Route management routes
app.use("/api/routes", routeRoutes);

// Route recommendation routes
app.use(
  "/api/route-recommendation",
  routeRecommendationRoutes
);

// Traffic alert routes
app.use("/api/traffic-alerts", trafficAlertRoutes);

// Traffic analytics routes
app.use("/api/traffic-analytics", trafficAnalyticsRoutes);

// Congestion event routes
app.use("/api/congestion-events", congestionEventRoutes);

// Citizen report routes
app.use("/api/citizen-reports", citizenReportRoutes);

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Smart Traffic Management System API",
    status: "running",
  });
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    service: "STM Backend",
  });
});

// Start server
const startServer = async () => {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`STM Backend running on http://localhost:${PORT}`);
  });
};

startServer();