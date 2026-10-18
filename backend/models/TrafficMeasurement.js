const mongoose = require("mongoose");

const processingResultSchema = new mongoose.Schema(
  {
    congestionDetected: Boolean,
    congestionLevel: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "SEVERE"],
    },
    alertCreated: Boolean,
    message: { type: String, maxlength: 512 },
  },
  { _id: false }
);

const processingSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "RETRY", "COMPLETED", "FAILED"],
      default: "PENDING",
      required: true,
    },
    attempts: { type: Number, default: 0, min: 0, required: true },
    nextAttemptAt: Date,
    leaseToken: { type: String, select: false },
    leaseUntil: Date,
    stage: {
      type: String,
      enum: ["DETECTION_COMPLETED", "ALERT_COMPLETED"],
      default: null,
    },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "CongestionEvent" },
    alertId: { type: mongoose.Schema.Types.ObjectId, ref: "TrafficAlert" },
    result: { type: processingResultSchema, default: undefined },
    lastError: { type: String, maxlength: 512 },
    completedAt: Date,
  },
  { _id: false }
);

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

    source: {
      type: String,
      enum: ["API", "SIMULATOR"],
      default: "API",
      required: true,
    },

    measuredAt: {
      type: Date,
      default: Date.now,
    },
    processing: {
      type: processingSchema,
      default: () => ({}),
      select: false,
    },
  },
  {
    timestamps: true,
    autoIndex: false,
    toJSON: {
      transform(document, value) {
        delete value.processing;
        return value;
      },
    },
    toObject: {
      transform(document, value) {
        delete value.processing;
        return value;
      },
    },
  }
);

trafficMeasurementSchema.index(
  {
    "processing.status": 1,
    "processing.nextAttemptAt": 1,
    "processing.leaseUntil": 1,
    createdAt: 1,
    _id: 1,
  },
  { name: "traffic_measurement_processing_queue" }
);

module.exports = mongoose.model(
  "TrafficMeasurement",
  trafficMeasurementSchema
);