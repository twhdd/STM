const mongoose = require("mongoose");

const emergencyVehicleSchema = new mongoose.Schema(
  {
    vehicleId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    vehicleType: {
      type: String,
      enum: ["AMBULANCE", "FIRE_TRUCK", "POLICE"],
      required: true,
    },

    registrationNumber: {
      type: String,
      required: true,
      trim: true,
    },

    currentLocation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TrafficLocation",
      required: true,
    },

    status: {
      type: String,
      enum: ["AVAILABLE", "EN_ROUTE", "ON_SCENE", "INACTIVE"],
      default: "AVAILABLE",
    },

    priorityActive: {
      type: Boolean,
      default: false,
    },

    activatedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "EmergencyVehicle",
  emergencyVehicleSchema
);