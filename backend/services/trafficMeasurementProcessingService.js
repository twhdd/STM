const congestionDetectionService = require("./congestionDetectionService");
const trafficAlertService = require("./trafficAlertService");
const CongestionEvent = require("../models/CongestionEvent");

const processTrafficMeasurement = async (
  measurementId,
  { resumeFrom, eventId, alertId, result, checkpoint } = {}
) => {
  if (resumeFrom === "ALERT_COMPLETED") {
    const event = eventId ? await CongestionEvent.findById(eventId) : null;
    if (!event) {
      throw new Error("Persisted congestion event checkpoint could not be found");
    }
    return {
      completed: true,
      congestionDetected: true,
      congestionLevel: event?.congestionLevel,
      eventId,
      alertCreated: result?.alertCreated ?? false,
      alertId,
      message:
        result?.message || "Traffic processing completed from its persisted checkpoint",
    };
  }

  let detection;
  if (resumeFrom === "DETECTION_COMPLETED" && eventId) {
    const event = await CongestionEvent.findById(eventId);
    if (!event) {
      throw new Error("Persisted congestion event checkpoint could not be found");
    }
    detection = {
      congestionDetected: event.status === "ACTIVE",
      congestionLevel: event.congestionLevel,
      event,
      message:
        event.status === "ACTIVE"
          ? "Resuming processing for the active congestion episode"
          : "Congestion event was resolved before alert recovery",
    };
  }
  detection ||= await congestionDetectionService.detectCongestion(measurementId);

  await checkpoint?.({
    stage: "DETECTION_COMPLETED",
    eventId: detection.event?._id || null,
  });

  if (!detection.congestionDetected) {
    return {
      completed: true,
      congestionDetected: false,
      congestionLevel: detection.congestionLevel,
      alertCreated: false,
      message: detection.message,
    };
  }

  if (!detection.event?._id) {
    throw new Error("Congestion detection reported an event without an ID");
  }

  const alert = await trafficAlertService.createCongestionAlert(
    detection.event._id
  );
  await checkpoint?.({
    stage: "ALERT_COMPLETED",
    eventId: detection.event._id,
    alertId: alert.alert?._id || null,
    alertCreated: alert.alertCreated,
    message: alert.message,
  });

  return {
    completed: true,
    congestionDetected: true,
    congestionLevel: detection.congestionLevel,
    eventId: detection.event._id,
    alertCreated: alert.alertCreated,
    alertId: alert.alert?._id,
    message: alert.message,
  };
};

module.exports = {
  processTrafficMeasurement,
};
