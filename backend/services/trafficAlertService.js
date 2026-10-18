const CongestionEvent = require("../models/CongestionEvent");
const TrafficAlert = require("../models/TrafficAlert");
const { realtimeService } = require("./realtimeService");
const createKeyedOperationLock = require("./keyedOperationLock");

const runEventOperation = createKeyedOperationLock();
const ACTIVE_ALERT_INDEX = "active_congestion_alert_per_event";

const isActiveAlertDuplicateKeyError = (error) =>
  error?.code === 11000 &&
  (error.keyPattern?.congestionEvent === 1 ||
    error.message?.includes(`index: ${ACTIVE_ALERT_INDEX}`));

// Generate an alert from a congestion event
const createCongestionAlert = async (congestionEventId) =>
  runEventOperation(congestionEventId, async () => {
    const event = await CongestionEvent.findById(congestionEventId);

    if (!event) {
      throw new Error("Congestion event not found");
    }

    if (event.status === "RESOLVED") {
      return {
        alertCreated: false,
        message: "Congestion event is resolved; no alert was created",
      };
    }

    const existingAlert = await TrafficAlert.findOne({
      congestionEvent: event._id,
      status: "ACTIVE",
      alertType: "CONGESTION",
    });

    if (existingAlert) {
      return {
        alertCreated: false,
        alert: existingAlert,
        message: "Active alert already exists for this congestion event",
      };
    }

    let severity = "INFO";

    if (event.congestionLevel === "HIGH") {
      severity = "WARNING";
    }

    if (event.congestionLevel === "SEVERE") {
      severity = "CRITICAL";
    }

    const alert = new TrafficAlert({
      alertType: "CONGESTION",
      location: event.location,
      congestionEvent: event._id,
      message: `${event.congestionLevel} congestion detected at the affected location`,
      severity,
    });

    let savedAlert;
    try {
      savedAlert = await alert.save();
    } catch (error) {
      if (!isActiveAlertDuplicateKeyError(error)) {
        throw error;
      }

      const winningAlert = await TrafficAlert.findOne({
        congestionEvent: event._id,
        status: "ACTIVE",
        alertType: "CONGESTION",
      });
      if (!winningAlert) {
        throw error;
      }

      return {
        alertCreated: false,
        alert: winningAlert,
        message: "Active alert already exists for this congestion event",
      };
    }

    realtimeService.publishAlertCreated(savedAlert);

    const currentEvent = await CongestionEvent.findById(event._id);
    if (currentEvent?.status === "RESOLVED") {
      savedAlert.status = "RESOLVED";
      savedAlert.resolvedAt = currentEvent.resolvedAt || new Date();
      const resolvedAlert = await savedAlert.save();
      realtimeService.publishAlertResolved(resolvedAlert);
    }

    return {
      alertCreated: true,
      alert: savedAlert,
      message: "Traffic alert created successfully",
    };
  });

const resolveActiveAlertsForEvent = async (event) =>
  runEventOperation(event._id, async () => {
    const activeAlerts = await TrafficAlert.find({
      congestionEvent: event._id,
      status: "ACTIVE",
    });

    for (const alert of activeAlerts) {
      alert.status = "RESOLVED";
      alert.resolvedAt = event.resolvedAt || new Date();
      const resolvedAlert = await alert.save();
      realtimeService.publishAlertResolved(resolvedAlert);
    }

    return activeAlerts.length;
  });

const resolveActiveAlertsForLocation = async (locationId) => {
  const activeAlerts = await TrafficAlert.find({
    location: locationId,
    alertType: "CONGESTION",
    status: "ACTIVE",
  });
  let resolvedCount = 0;

  for (const alert of activeAlerts) {
    const event = await CongestionEvent.findById(alert.congestionEvent);
    if (event?.status === "RESOLVED") {
      resolvedCount += await resolveActiveAlertsForEvent(event);
    }
  }

  return resolvedCount;
};

module.exports = {
  createCongestionAlert,
  resolveActiveAlertsForEvent,
  resolveActiveAlertsForLocation,
};