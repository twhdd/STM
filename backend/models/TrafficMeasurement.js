const mongoose = require("mongoose");

const trafficMeasurementSchema = new mongoose.Schema(
  {
    device: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MonitoringDevice",
      required: true,
    },

    location: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TrafficLocation",
      required: true,
    },

    vehicleCount: {
      type: Number,
      required: true,
      min: 0,
    },

    averageSpeed: {
      type: Number,
      required: true,
      min: 0,
    },

    trafficDensity: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "SEVERE"],
      required: true,
    },

    measuredAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "TrafficMeasurement",
  trafficMeasurementSchema
);