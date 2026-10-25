const mongoose = require("mongoose");

const routeSchema = new mongoose.Schema(
  {
    routeId: {
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

    startLocation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TrafficLocation",
      required: true,
    },

    endLocation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TrafficLocation",
      required: true,
    },

    // Optional, ordered monitored locations the route passes through. Without
    // them a route has no measurement-based traffic status.
    waypoints: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "TrafficLocation" }],
      default: undefined,
    },

    distance: {
      type: Number,
      required: true,
      min: 0,
    },

    estimatedTime: {
      type: Number,
      required: true,
      min: 0,
    },

    status: {
      type: String,
      enum: ["AVAILABLE", "CONGESTED", "BLOCKED"],
      default: "AVAILABLE",
    },

    trafficLevel: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "SEVERE"],
      default: "LOW",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Route", routeSchema);