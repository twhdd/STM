const mongoose = require("mongoose");
const EmergencyVehicle = require("../models/EmergencyVehicle");
const TrafficSignal = require("../models/TrafficSignal");

const EMERGENCY_PHASE = "NORTH_SOUTH";
const EMERGENCY_GREEN_TIME = 60;
const DEFAULT_GREEN_TIME = TrafficSignal.schema.path("greenTime").options.default;
const LEGACY_FALLBACK = "LEGACY_NO_SAVED_STATE";

class EmergencyPriorityError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "EmergencyPriorityError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

async function loadVehicle(vehicleId) {
  if (typeof vehicleId !== "string" || !mongoose.isValidObjectId(vehicleId)) {
    throw new EmergencyPriorityError(
      400,
      "INVALID_ID",
      "vehicleId must be a valid emergency vehicle ID"
    );
  }

  const vehicle = await EmergencyVehicle.findById(vehicleId);

  if (!vehicle) {
    throw new EmergencyPriorityError(
      404,
      "VEHICLE_NOT_FOUND",
      "Emergency vehicle not found"
    );
  }

  return vehicle;
}

const describeSignal = (signal) =>
  signal
    ? {
        signalId: signal.signalId,
        name: signal.name,
        currentPhase: signal.currentPhase,
        greenTime: signal.greenTime,
      }
    : null;

// Activate emergency priority for a vehicle and its current location
const activateEmergencyPriority = async (vehicleId) => {
  const vehicle = await loadVehicle(vehicleId);

  if (vehicle.priorityActive) {
    throw new EmergencyPriorityError(
      409,
      "PRIORITY_ALREADY_ACTIVE",
      "Emergency priority is already active for this vehicle"
    );
  }

  if (vehicle.status === "INACTIVE") {
    throw new EmergencyPriorityError(
      409,
      "VEHICLE_INACTIVE",
      "An inactive emergency vehicle cannot request priority"
    );
  }

  const signal = await TrafficSignal.findOne({
    location: vehicle.currentLocation,
    status: "ACTIVE",
  });

  if (!signal) {
    throw new EmergencyPriorityError(
      409,
      "NO_ACTIVE_SIGNAL",
      "No active traffic signal found at the emergency vehicle location"
    );
  }

  if (signal.priorityOverride?.vehicle) {
    throw new EmergencyPriorityError(
      409,
      "SIGNAL_ALREADY_OVERRIDDEN",
      "This signal is already under an emergency priority override"
    );
  }

  const activatedAt = new Date();

  // Compare-and-set: only succeeds if the signal is still exactly as read and
  // carries no override, so the saved previous state is written exactly once.
  const overriddenSignal = await TrafficSignal.findOneAndUpdate(
    {
      _id: signal._id,
      status: "ACTIVE",
      currentPhase: signal.currentPhase,
      greenTime: signal.greenTime,
      "priorityOverride.vehicle": { $exists: false },
    },
    {
      $set: {
        priorityOverride: {
          vehicle: vehicle._id,
          previousPhase: signal.currentPhase,
          previousGreenTime: signal.greenTime,
          activatedAt,
        },
        currentPhase: EMERGENCY_PHASE,
        greenTime: EMERGENCY_GREEN_TIME,
        lastOptimizedAt: activatedAt,
      },
    },
    { new: true }
  );

  if (!overriddenSignal) {
    throw new EmergencyPriorityError(
      409,
      "SIGNAL_CHANGED",
      "The traffic signal changed while priority was being activated; try again"
    );
  }

  const claimed = await EmergencyVehicle.updateOne(
    { _id: vehicle._id, priorityActive: { $ne: true } },
    { $set: { priorityActive: true, activatedAt } }
  );

  if (!claimed.modifiedCount) {
    await TrafficSignal.updateOne(
      { _id: signal._id, "priorityOverride.vehicle": vehicle._id },
      {
        $set: {
          currentPhase: signal.currentPhase,
          greenTime: signal.greenTime,
        },
        $unset: { priorityOverride: 1 },
      }
    );

    throw new EmergencyPriorityError(
      409,
      "PRIORITY_ALREADY_ACTIVE",
      "Emergency priority is already active for this vehicle"
    );
  }

  return {
    vehicle: {
      vehicleId: vehicle.vehicleId,
      vehicleType: vehicle.vehicleType,
      status: vehicle.status,
      priorityActive: true,
      activatedAt,
    },
    signal: {
      ...describeSignal(overriddenSignal),
      previousPhase: signal.currentPhase,
      previousGreenTime: signal.greenTime,
    },
    message: "Emergency vehicle priority activated successfully",
  };
};

// Deactivate emergency priority and restore the signal's saved state
const deactivateEmergencyPriority = async (vehicleId) => {
  const vehicle = await loadVehicle(vehicleId);

  if (!vehicle.priorityActive) {
    throw new EmergencyPriorityError(
      409,
      "PRIORITY_NOT_ACTIVE",
      "Emergency priority is not active for this vehicle"
    );
  }

  const overridden = await TrafficSignal.findOne({
    "priorityOverride.vehicle": vehicle._id,
  });

  let signal;
  let fallback = null;

  if (overridden) {
    const { previousPhase, previousGreenTime } = overridden.priorityOverride;

    // A null result means another request already restored this signal.
    signal = await TrafficSignal.findOneAndUpdate(
      { _id: overridden._id, "priorityOverride.vehicle": vehicle._id },
      {
        $set: { currentPhase: previousPhase, greenTime: previousGreenTime },
        $unset: { priorityOverride: 1 },
      },
      { new: true }
    );
  } else {
    // Priority activated before override state was recorded: keep the phase and
    // reset only the green time to the schema default.
    fallback = LEGACY_FALLBACK;
    signal = await TrafficSignal.findOneAndUpdate(
      {
        location: vehicle.currentLocation,
        status: "ACTIVE",
        "priorityOverride.vehicle": { $exists: false },
      },
      { $set: { greenTime: DEFAULT_GREEN_TIME } },
      { new: true }
    );
  }

  const cleared = await EmergencyVehicle.updateOne(
    { _id: vehicle._id, priorityActive: true },
    { $set: { priorityActive: false }, $unset: { activatedAt: 1 } }
  );

  if (!cleared.modifiedCount) {
    throw new EmergencyPriorityError(
      409,
      "PRIORITY_NOT_ACTIVE",
      "Emergency priority is not active for this vehicle"
    );
  }

  let message = "Emergency priority deactivated and the signal state restored";
  if (fallback) {
    message = signal
      ? `Emergency priority deactivated; no saved signal state existed, so the green time was reset to the default of ${DEFAULT_GREEN_TIME} seconds`
      : "Emergency priority deactivated; no saved signal state existed and no signal could be reset";
  }

  return {
    vehicle: {
      vehicleId: vehicle.vehicleId,
      vehicleType: vehicle.vehicleType,
      status: vehicle.status,
      priorityActive: false,
    },
    signal: describeSignal(signal),
    fallback,
    message,
  };
};

module.exports = {
  DEFAULT_GREEN_TIME,
  EmergencyPriorityError,
  LEGACY_FALLBACK,
  activateEmergencyPriority,
  deactivateEmergencyPriority,
};
