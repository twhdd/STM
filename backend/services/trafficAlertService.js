const CongestionEvent = require("../models/CongestionEvent");
const TrafficAlert = require("../models/TrafficAlert");

// Generate an alert from a congestion event
const createCongestionAlert = async (congestionEventId) => {
  const event = await CongestionEvent.findById(congestionEventId);

  if (!event) {
    throw new Error("Congestion event not found");
  }

  // Prevent duplicate active alerts for the same event
  const existingAlert = await TrafficAlert.findOne({
    congestionEvent: event._id,
    status: "ACTIVE",
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

  const savedAlert = await alert.save();

  return {
    alertCreated: true,
    alert: savedAlert,
    message: "Traffic alert created successfully",
  };
};

module.exports = {
  createCongestionAlert,
};