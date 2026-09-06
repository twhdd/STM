const mongoose = require("mongoose");

const trafficSignalSchema = new mongoose.Schema(
  {
    signalId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
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

    currentPhase: {
      type: String,
      enum: ["NORTH_SOUTH", "EAST_WEST", "ALL_RED"],
      default: "NORTH_SOUTH",
    },

    greenTime: {
      type: Number,
      required: true,
      min: 5,
      default: 30,
    },

    yellowTime: {
      type: Number,
      required: true,
      min: 3,
      default: 5,
    },

    redTime: {
      type: Number,
      required: true,
      min: 5,
      default: 30,
    },

    lastOptimizedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("TrafficSignal", trafficSignalSchema);