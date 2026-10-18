const TrafficMeasurement = require("../models/TrafficMeasurement");
const CongestionEvent = require("../models/CongestionEvent");
const { realtimeService } = require("./realtimeService");
const trafficAlertService = require("./trafficAlertService");
const createKeyedOperationLock = require("./keyedOperationLock");

const runLocationOperation = createKeyedOperationLock();
const ACTIVE_EVENT_INDEX = "active_congestion_event_per_location";

const isActiveEventDuplicateKeyError = (error) =>
  error?.code === 11000 &&
  (error.keyPattern?.location === 1 ||
    error.message?.includes(`index: ${ACTIVE_EVENT_INDEX}`));

// Determine congestion level from traffic measurement
const determineCongestionLevel = (vehicleCount, averageSpeed) => {
  if (vehicleCount >= 100 || averageSpeed < 15) {
    return "SEVERE";
  }

  if (vehicleCount >= 70 || averageSpeed < 25) {
    return "HIGH";
  }

  if (vehicleCount >= 40 || averageSpeed < 35) {
    return "MEDIUM";
  }

  return "LOW";
};

// Analyze a traffic measurement and create a congestion event if needed
const detectCongestion = async (measurementId) => {
  const measurement = await TrafficMeasurement.findById(measurementId);

  if (!measurement) {
    throw new Error("Traffic measurement not found");
  }

  const congestionLevel = determineCongestionLevel(
    measurement.vehicleCount,
    measurement.averageSpeed
  );

  return runLocationOperation(measurement.location, async () => {
    if (congestionLevel !== "HIGH" && congestionLevel !== "SEVERE") {
      const activeEvents = await CongestionEvent.find({
        location: measurement.location,
        status: "ACTIVE",
      });
      const resolvedAt = new Date();

      for (const event of activeEvents) {
        event.status = "RESOLVED";
        event.resolvedAt = resolvedAt;
        const resolvedEvent = await event.save();
        realtimeService.publishCongestionCleared(resolvedEvent);
      }
      const resolvedAlertCount =
        await trafficAlertService.resolveActiveAlertsForLocation(
          measurement.location
        );

      return {
        congestionDetected: false,
        congestionLevel,
        message:
          activeEvents.length > 0 || resolvedAlertCount > 0
            ? "Congestion cleared; active events and alerts were resolved"
            : "No significant congestion detected",
      };
    }

    const existingEvent = await CongestionEvent.findOne({
      location: measurement.location,
      status: "ACTIVE",
    });

    if (existingEvent) {
      return {
        congestionDetected: true,
        congestionLevel: existingEvent.congestionLevel,
        event: existingEvent,
        message: "Active congestion episode already exists",
      };
    }

    const event = new CongestionEvent({
      location: measurement.location,
      measurement: measurement._id,
      congestionLevel,
      vehicleCount: measurement.vehicleCount,
      averageSpeed: measurement.averageSpeed,
      description: `${congestionLevel} congestion detected based on traffic measurement`,
    });

    let savedEvent;
    try {
      savedEvent = await event.save();
    } catch (error) {
      if (!isActiveEventDuplicateKeyError(error)) {
        throw error;
      }

      const winningEvent = await CongestionEvent.findOne({
        location: measurement.location,
        status: "ACTIVE",
      });
      if (!winningEvent) {
        throw error;
      }

      return {
        congestionDetected: true,
        congestionLevel: winningEvent.congestionLevel,
        event: winningEvent,
        message: "Active congestion episode already exists",
      };
    }

    realtimeService.publishCongestionDetected(savedEvent);

    return {
      congestionDetected: true,
      congestionLevel,
      event: savedEvent,
      message: "Congestion detected successfully",
    };
  });
};

module.exports = {
  determineCongestionLevel,
  detectCongestion,
};