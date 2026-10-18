const mongoose = require("mongoose");

const congestionEventSchema = new mongoose.Schema(
  {
    location: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TrafficLocation",
      required: true,
    },

    measurement: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TrafficMeasurement",
      required: true,
    },

    congestionLevel: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "SEVERE"],
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

    description: {
      type: String,
      trim: true,
    },

    status: {
      type: String,
      enum: ["ACTIVE", "RESOLVED"],
      default: "ACTIVE",
    },

    detectedAt: {
      type: Date,
      default: Date.now,
    },

    resolvedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    autoIndex: false,
  }
);

congestionEventSchema.index(
  { location: 1 },
  {
    name: "active_congestion_event_per_location",
    unique: true,
    partialFilterExpression: {
      status: "ACTIVE",
      location: { $type: "objectId" },
    },
  }
);

module.exports = mongoose.model(
  "CongestionEvent",
  congestionEventSchema
);