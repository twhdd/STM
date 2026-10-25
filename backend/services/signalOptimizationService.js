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

const overrideActiveError = () => {
  const error = new Error(
    "This signal is under an active emergency priority override and cannot be optimized"
  );
  error.statusCode = 409;
  error.code = "EMERGENCY_OVERRIDE_ACTIVE";
  return error;
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

  if (signal.priorityOverride?.vehicle) {
    throw overrideActiveError();
  }

  const previousGreenTime = signal.greenTime;

  const optimalGreenTime = calculateGreenTime(
    measurement.vehicleCount,
    measurement.averageSpeed
  );

  // Guarded write: refused if an emergency override was claimed after the read.
  const updatedSignal = await TrafficSignal.findOneAndUpdate(
    { _id: signal._id, "priorityOverride.vehicle": { $exists: false } },
    { $set: { greenTime: optimalGreenTime, lastOptimizedAt: new Date() } },
    { new: true }
  );

  if (!updatedSignal) {
    throw overrideActiveError();
  }

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