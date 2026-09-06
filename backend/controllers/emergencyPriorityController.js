const {
  activateEmergencyPriority,
} = require("../services/emergencyPriorityService");

// Activate emergency vehicle priority
const runEmergencyPriority = async (req, res) => {
  try {
    const { vehicleId } = req.body;

    if (!vehicleId) {
      return res.status(400).json({
        message: "vehicleId is required",
      });
    }

    const result = await activateEmergencyPriority(vehicleId);

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      message: "Failed to activate emergency priority",
      error: error.message,
    });
  }
};

module.exports = {
  runEmergencyPriority,
};