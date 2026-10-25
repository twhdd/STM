const {
  activateEmergencyPriority,
  deactivateEmergencyPriority,
} = require("../services/emergencyPriorityService");

function sendFailure(res, error, fallbackMessage) {
  if (error && error.name === "EmergencyPriorityError") {
    return res.status(error.statusCode).json({
      message: error.message,
      code: error.code,
    });
  }

  console.error(`${fallbackMessage}:`, error);
  return res.status(500).json({
    message: fallbackMessage,
    code: "INTERNAL_ERROR",
  });
}

function requireVehicleId(req, res) {
  const { vehicleId } = req.body || {};

  if (!vehicleId) {
    res.status(400).json({
      message: "vehicleId is required",
      code: "VEHICLE_ID_REQUIRED",
    });
    return null;
  }

  return vehicleId;
}

// Activate emergency vehicle priority
const runEmergencyPriority = async (req, res) => {
  const vehicleId = requireVehicleId(req, res);
  if (!vehicleId) return;

  try {
    const result = await activateEmergencyPriority(vehicleId);

    res.status(200).json(result);
  } catch (error) {
    sendFailure(res, error, "Failed to activate emergency priority");
  }
};

// Deactivate emergency vehicle priority and restore the signal
const runEmergencyDeactivation = async (req, res) => {
  const vehicleId = requireVehicleId(req, res);
  if (!vehicleId) return;

  try {
    const result = await deactivateEmergencyPriority(vehicleId);

    res.status(200).json(result);
  } catch (error) {
    sendFailure(res, error, "Failed to deactivate emergency priority");
  }
};

module.exports = {
  runEmergencyDeactivation,
  runEmergencyPriority,
};
