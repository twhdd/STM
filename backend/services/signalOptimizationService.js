const TrafficMeasurement = require("../models/TrafficMeasurement");
const TrafficSignal = require("../models/TrafficSignal");

// Calculate optimal green time based on traffic conditions
const calculateGreenTime = (vehicleCount, averageSpeed) => {
  if (vehicleCount >= 100 || averageSpeed < 15) {
    return 60;
  }

  if (vehicleCount >= 70 || averageSpeed < 25) {
    return 45;
  }

  if (vehicleCount >= 40 || averageSpeed < 35) {
    return 30;
  }

  return 20;
};

// Optimize a traffic signal using a traffic measurement
const optimizeSignal = async (signalId, measurementId) => {
  const signal = await TrafficSignal.findById(signalId);
  const measurement = await TrafficMeasurement.findById(measurementId);

  if (!signal) {
    throw new Error("Traffic signal not found");
  }

  if (!measurement) {
    throw new Error("Traffic measurement not found");
  }

  const previousGreenTime = signal.greenTime;

  const optimalGreenTime = calculateGreenTime(
    measurement.vehicleCount,
    measurement.averageSpeed
  );

  signal.greenTime = optimalGreenTime;
  signal.lastOptimizedAt = new Date();

  const updatedSignal = await signal.save();

  return {
    signal: updatedSignal,
    measurement: {
      vehicleCount: measurement.vehicleCount,
      averageSpeed: measurement.averageSpeed,
      trafficDensity: measurement.trafficDensity,
    },
    optimization: {
      previousGreenTime,
      newGreenTime: optimalGreenTime,
    },
    message: "Traffic signal optimized successfully",
  };
};

module.exports = {
  calculateGreenTime,
  optimizeSignal,
};