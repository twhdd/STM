const mongoose = require("mongoose");

const trafficAlertSchema = new mongoose.Schema(
  {
    alertType: {
      type: String,
      enum: [
        "CONGESTION",
        "ACCIDENT",
        "ROAD_BLOCKAGE",
        "EMERGENCY",
        "SIGNAL_ISSUE",
      ],
      required: true,
    },

    location: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TrafficLocation",
      required: true,
    },

    congestionEvent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CongestionEvent",
    },

    emergencyVehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EmergencyVehicle",
    },

    message: {
      type: String,
      required: true,
      trim: true,
    },

    severity: {
      type: String,
      enum: ["INFO", "WARNING", "CRITICAL"],
      required: true,
    },

    status: {
      type: String,
      enum: ["ACTIVE", "RESOLVED"],
      default: "ACTIVE",
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },

    resolvedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("TrafficAlert", trafficAlertSchema);