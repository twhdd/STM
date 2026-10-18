const mongoose = require("mongoose");

const trafficMeasurementProcessingLeaseSchema = new mongoose.Schema(
  {
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TrafficLocation",
      required: true,
    },
    token: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model(
  "TrafficMeasurementProcessingLease",
  trafficMeasurementProcessingLeaseSchema
);
