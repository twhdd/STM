const TrafficMeasurement = require("../models/TrafficMeasurement");
const CongestionEvent = require("../models/CongestionEvent");

// Determine congestion level from traffic measurement
const determineCongestionLevel = (vehicleCount, averageSpeed) => {
  if (vehicleCount >= 100 || averageSpeed < 15) {
    return "SEVERE";
  }

  if (vehicleCount >= 70 || averageSpeed < 25) {
    return "HIGH";
  }

  if (vehicleCount >= 40 || averageSpeed < 35) {
    return "MEDIUM";
  }

  return "LOW";
};

// Analyze a traffic measurement and create a congestion event if needed
const detectCongestion = async (measurementId) => {
  const measurement = await TrafficMeasurement.findById(measurementId);

  if (!measurement) {
    throw new Error("Traffic measurement not found");
  }

  const congestionLevel = determineCongestionLevel(
    measurement.vehicleCount,
    measurement.averageSpeed
  );

  // Only create an event for HIGH or SEVERE congestion
  if (congestionLevel !== "HIGH" && congestionLevel !== "SEVERE") {
    return {
      congestionDetected: false,
      congestionLevel,
      message: "No significant congestion detected",
    };
  }

  const existingEvent = await CongestionEvent.findOne({
    measurement: measurement._id,
    status: "ACTIVE",
  });

  if (existingEvent) {
    return {
      congestionDetected: true,
      congestionLevel,
      event: existingEvent,
      message: "Active congestion event already exists",
    };
  }

  const event = new CongestionEvent({
    location: measurement.location,
    measurement: measurement._id,
    congestionLevel,
    vehicleCount: measurement.vehicleCount,
    averageSpeed: measurement.averageSpeed,
    description: `${congestionLevel} congestion detected based on traffic measurement`,
  });

  const savedEvent = await event.save();

  return {
    congestionDetected: true,
    congestionLevel,
    event: savedEvent,
    message: "Congestion detected successfully",
  };
};

module.exports = {
  determineCongestionLevel,
  detectCongestion,
};