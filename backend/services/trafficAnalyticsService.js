const TrafficMeasurement = require("../models/TrafficMeasurement");
const CongestionEvent = require("../models/CongestionEvent");
const TrafficAlert = require("../models/TrafficAlert");

// Generate traffic analytics
const getTrafficAnalytics = async () => {
  const measurements = await TrafficMeasurement.find();

  const congestionEvents = await CongestionEvent.find();

  const activeAlerts = await TrafficAlert.countDocuments({
    status: "ACTIVE",
  });

  if (measurements.length === 0) {
    return {
      totalMeasurements: 0,
      averageVehicleCount: 0,
      averageSpeed: 0,
      trafficDistribution: {},
      totalCongestionEvents: congestionEvents.length,
      activeAlerts,
    };
  }

  const totalVehicles = measurements.reduce(
    (sum, measurement) => sum + measurement.vehicleCount,
    0
  );

  const totalSpeed = measurements.reduce(
    (sum, measurement) => sum + measurement.averageSpeed,
    0
  );

  const trafficDistribution = {
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
    SEVERE: 0,
  };

  measurements.forEach((measurement) => {
    trafficDistribution[measurement.trafficDensity]++;
  });

  return {
    totalMeasurements: measurements.length,
    averageVehicleCount: Number(
      (totalVehicles / measurements.length).toFixed(2)
    ),
    averageSpeed: Number(
      (totalSpeed / measurements.length).toFixed(2)
    ),
    trafficDistribution,
    totalCongestionEvents: congestionEvents.length,
    activeAlerts,
  };
};

module.exports = {
  getTrafficAnalytics,
};