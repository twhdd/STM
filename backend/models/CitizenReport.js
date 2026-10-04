const mongoose = require("mongoose");

const citizenReportSchema = new mongoose.Schema(
  {
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    location: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TrafficLocation",
      required: true,
    },

    reportType: {
      type: String,
      required: true,
      enum: [
        "ACCIDENT",
        "CONGESTION",
        "ROAD_BLOCKAGE",
        "SIGNAL_ISSUE",
        "OTHER",
      ],
    },

    description: {
      type: String,
      required: true,
      trim: true,
    },

    severity: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH"],
      default: "MEDIUM",
    },

    status: {
      type: String,
      enum: [
        "SUBMITTED",
        "UNDER_REVIEW",
        "VERIFIED",
        "REJECTED",
        "RESOLVED",
      ],
      default: "SUBMITTED",
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    reviewedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("CitizenReport", citizenReportSchema);
