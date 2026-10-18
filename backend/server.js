const express = require("express");
const http = require("node:http");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config();

const connectDB = require("./config/database");
const {
  ensureCongestionLifecycleIndexes,
} = require("./services/congestionLifecycleIndexService");
const {
  trafficMeasurementRecoveryWorker,
} = require("./services/trafficMeasurementRecoveryWorker");
const { trafficSimulator } = require("./services/trafficSimulatorService");
const { realtimeService } = require("./services/realtimeService");
const { createSocketServer } = require("./socket/socketServer");
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
let httpServer;
let socketServer;

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

// Root endpoint (PUBLIC on purpose: static banner, no data; useful as a liveness probe)
app.get("/", (req, res) => {
  res.json({
    message: "Smart Traffic Management System API",
    status: "running",
  });
});

// Health check (PUBLIC on purpose: returns a fixed status object, no data, used by uptime checks)
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    service: "STM Backend",
  });
});

// Start server
const startServer = async ({
  port = PORT,
  connectDatabase = connectDB,
  ensureLifecycleIndexes = ensureCongestionLifecycleIndexes,
  recoveryWorker = trafficMeasurementRecoveryWorker,
  simulator = trafficSimulator,
  socketServerFactory = createSocketServer,
  realtime = realtimeService,
  appInstance = app,
  registerSignalHandlers = true,
} = {}) => {
  let shutdownPromise;
  await connectDatabase();
  await ensureLifecycleIndexes();
  await recoveryWorker.start();

  httpServer = http.createServer(appInstance);
  socketServer = socketServerFactory(httpServer);
  realtime.attach(socketServer);

  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, () => {
      httpServer.removeListener("error", reject);
      console.log(`STM Backend running on http://localhost:${httpServer.address().port}`);
      resolve();
    });
  });

  void simulator.start();

  const shutdown = (signal = "shutdown") => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      console.log(`Received ${signal}; stopping STM services...`);
      let shutdownError;
      const attempt = async (operation) => {
        try {
          await operation();
        } catch (error) {
          shutdownError ||= error;
        }
      };

      await attempt(() => simulator.stop());
      if (socketServer) {
        const closingSocketServer = socketServer;
        await attempt(
          () =>
            new Promise((resolve, reject) =>
              closingSocketServer.close((error) =>
                error ? reject(error) : resolve()
              )
            )
        );
        realtime.detach(closingSocketServer);
        socketServer = null;
      } else if (httpServer?.listening) {
        await attempt(
          () =>
            new Promise((resolve, reject) =>
              httpServer.close((error) => (error ? reject(error) : resolve()))
            )
        );
      }
      await attempt(() => recoveryWorker.stop());
      if (mongoose.connection.readyState !== 0) {
        await attempt(() => mongoose.disconnect());
      }
      if (shutdownError) throw shutdownError;
    })().catch((error) => {
      console.error("STM shutdown failed:", error);
      process.exitCode = 1;
    });
    return shutdownPromise;
  };
  if (registerSignalHandlers) {
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  }
  return { httpServer, shutdown };
};

// Start listening only when run directly (node server.js); tests import the app
if (require.main === module) {
  startServer().catch(async (error) => {
    console.error("STM startup failed:", error);
    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      console.error("STM startup cleanup failed:", disconnectError);
    }
    process.exitCode = 1;
  });
}

module.exports = app;
module.exports.startServer = startServer;