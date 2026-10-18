const TrafficMeasurement = require("../models/TrafficMeasurement");
const {
  trafficMeasurementRecoveryWorker,
} = require("./trafficMeasurementRecoveryWorker");
const { realtimeService } = require("./realtimeService");

const recordTrafficMeasurement = async (measurementData) => {
  const measurement = new TrafficMeasurement(measurementData);
  const savedMeasurement = await measurement.save();
  realtimeService.publishMeasurementCreated(savedMeasurement);

  let processing;
  try {
    processing = await trafficMeasurementRecoveryWorker.processMeasurementNow(
      savedMeasurement._id
    );
  } catch (error) {
    console.error(
      `Automatic traffic processing failed for measurement ${savedMeasurement._id}:`,
      error
    );
    processing = {
      completed: false,
      message:
        "The measurement was saved, but automatic congestion processing failed.",
    };
  }

  return {
    measurement: savedMeasurement,
    processing,
  };
};

module.exports = {
  recordTrafficMeasurement,
};
