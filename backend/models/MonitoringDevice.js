const mongoose = require("mongoose");

const monitoringDeviceSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    deviceType: {
      type: String,
      enum: ["CCTV", "TRAFFIC_SENSOR", "GPS"],
      required: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    location: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TrafficLocation",
      required: true,
    },

    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "MAINTENANCE"],
      default: "ACTIVE",
    },

    lastActiveAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "MonitoringDevice",
  monitoringDeviceSchema
);