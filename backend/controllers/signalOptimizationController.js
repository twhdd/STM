const {
  optimizeSignal,
} = require("../services/signalOptimizationService");

// Optimize a traffic signal
const runSignalOptimization = async (req, res) => {
  try {
    const { signalId, measurementId } = req.body;

    if (!signalId || !measurementId) {
      return res.status(400).json({
        message: "signalId and measurementId are required",
      });
    }

    const result = await optimizeSignal(signalId, measurementId);

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      message: "Failed to optimize traffic signal",
      error: error.message,
    });
  }
};

module.exports = {
  runSignalOptimization,
};