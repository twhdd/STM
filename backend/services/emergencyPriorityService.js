const EmergencyVehicle = require("../models/EmergencyVehicle");
const TrafficSignal = require("../models/TrafficSignal");

// Activate emergency priority for a vehicle and its current location
const activateEmergencyPriority = async (vehicleId) => {
  const vehicle = await EmergencyVehicle.findById(vehicleId);

  if (!vehicle) {
    throw new Error("Emergency vehicle not found");
  }

  const signal = await TrafficSignal.findOne({
    location: vehicle.currentLocation,
    status: "ACTIVE",
  });

  if (!signal) {
    throw new Error(
      "No active traffic signal found at the emergency vehicle location"
    );
  }

  vehicle.priorityActive = true;
  vehicle.activatedAt = new Date();

  await vehicle.save();

  // Set the signal to emergency priority mode
  signal.currentPhase = "NORTH_SOUTH";
  signal.greenTime = 60;
  signal.lastOptimizedAt = new Date();

  await signal.save();

  return {
    vehicle: {
      vehicleId: vehicle.vehicleId,
      vehicleType: vehicle.vehicleType,
      status: vehicle.status,
      priorityActive: vehicle.priorityActive,
    },
    signal: {
      signalId: signal.signalId,
      name: signal.name,
      currentPhase: signal.currentPhase,
      greenTime: signal.greenTime,
    },
    message: "Emergency vehicle priority activated successfully",
  };
};

module.exports = {
  activateEmergencyPriority,
};