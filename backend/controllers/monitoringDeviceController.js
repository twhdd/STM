const MonitoringDevice = require("../models/MonitoringDevice");

// Register a new monitoring device
const createMonitoringDevice = async (req, res) => {
  try {
    const {
      deviceId,
      deviceType,
      name,
      location,
      status,
    } = req.body;

    const device = new MonitoringDevice({
      deviceId,
      deviceType,
      name,
      location,
      status,
    });

    const savedDevice = await device.save();

    res.status(201).json({
      message: "Monitoring device registered successfully",
      device: savedDevice,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to register monitoring device",
      error: error.message,
    });
  }
};

// Get all monitoring devices
const getMonitoringDevices = async (req, res) => {
  try {
    const devices = await MonitoringDevice.find()
      .populate("location", "name area latitude longitude");

    res.status(200).json({
      count: devices.length,
      devices,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch monitoring devices",
      error: error.message,
    });
  }
};

// Get one monitoring device by ID
const getMonitoringDeviceById = async (req, res) => {
  try {
    const device = await MonitoringDevice.findById(req.params.id)
      .populate("location", "name area latitude longitude");

    if (!device) {
      return res.status(404).json({
        message: "Monitoring device not found",
      });
    }

    res.status(200).json(device);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch monitoring device",
      error: error.message,
    });
  }
};

module.exports = {
  createMonitoringDevice,
  getMonitoringDevices,
  getMonitoringDeviceById,
};