const AUTHENTICATED_ROOM = "authenticated";

const REALTIME_EVENTS = Object.freeze({
  MEASUREMENT_CREATED: "measurement-created",
  CONGESTION_DETECTED: "congestion-detected",
  CONGESTION_CLEARED: "congestion-cleared",
  ALERT_CREATED: "alert-created",
  ALERT_RESOLVED: "alert-resolved",
});

function referenceId(value) {
  if (value && typeof value === "object" && value._id) {
    return String(value._id);
  }
  return value == null ? null : String(value);
}

function timestamp(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function createRealtimeService(logger = console) {
  let io = null;

  function publish(eventName, payload) {
    if (!io) return;

    try {
      io.to(AUTHENTICATED_ROOM).emit(eventName, payload);
    } catch (error) {
      logger.error(`Failed to publish realtime event "${eventName}":`, error);
    }
  }

  return {
    attach(socketServer) {
      io = socketServer;
    },
    detach(socketServer) {
      if (io === socketServer) io = null;
    },
    publishMeasurementCreated(measurement) {
      publish(REALTIME_EVENTS.MEASUREMENT_CREATED, {
        measurementId: referenceId(measurement._id),
        deviceId: referenceId(measurement.device),
        locationId: referenceId(measurement.location),
        source: measurement.source,
        measuredAt: timestamp(measurement.measuredAt),
        vehicleCount: measurement.vehicleCount,
        averageSpeed: measurement.averageSpeed,
        trafficDensity: measurement.trafficDensity,
      });
    },
    publishCongestionDetected(event) {
      publish(REALTIME_EVENTS.CONGESTION_DETECTED, {
        eventId: referenceId(event._id),
        measurementId: referenceId(event.measurement),
        locationId: referenceId(event.location),
        congestionLevel: event.congestionLevel,
        vehicleCount: event.vehicleCount,
        averageSpeed: event.averageSpeed,
        status: event.status,
        detectedAt: timestamp(event.detectedAt),
      });
    },
    publishCongestionCleared(event) {
      publish(REALTIME_EVENTS.CONGESTION_CLEARED, {
        eventId: referenceId(event._id),
        locationId: referenceId(event.location),
        status: event.status,
        detectedAt: timestamp(event.detectedAt),
        resolvedAt: timestamp(event.resolvedAt),
      });
    },
    publishAlertCreated(alert) {
      publish(REALTIME_EVENTS.ALERT_CREATED, {
        alertId: referenceId(alert._id),
        congestionEventId: referenceId(alert.congestionEvent),
        locationId: referenceId(alert.location),
        alertType: alert.alertType,
        severity: alert.severity,
        status: alert.status,
        message: alert.message,
        createdAt: timestamp(alert.createdAt),
      });
    },
    publishAlertResolved(alert) {
      publish(REALTIME_EVENTS.ALERT_RESOLVED, {
        alertId: referenceId(alert._id),
        congestionEventId: referenceId(alert.congestionEvent),
        locationId: referenceId(alert.location),
        status: alert.status,
        resolvedAt: timestamp(alert.resolvedAt),
      });
    },
  };
}

const realtimeService = createRealtimeService();

module.exports = {
  AUTHENTICATED_ROOM,
  REALTIME_EVENTS,
  createRealtimeService,
  realtimeService,
};
