const CongestionEvent = require("../models/CongestionEvent");
const TrafficAlert = require("../models/TrafficAlert");

const CONFLICT_REPORT_LIMIT = 20;

const ACTIVE_EVENT_CONFLICT_PIPELINE = [
  {
    $match: {
      status: "ACTIVE",
      location: { $type: "objectId" },
    },
  },
  {
    $group: {
      _id: "$location",
      count: { $sum: 1 },
      firstRecordId: { $first: "$_id" },
      lastRecordId: { $last: "$_id" },
    },
  },
  { $match: { count: { $gt: 1 } } },
  { $sort: { count: -1, _id: 1 } },
  { $limit: CONFLICT_REPORT_LIMIT },
];

const ACTIVE_ALERT_CONFLICT_PIPELINE = [
  {
    $match: {
      alertType: "CONGESTION",
      status: "ACTIVE",
      congestionEvent: { $type: "objectId" },
    },
  },
  {
    $group: {
      _id: "$congestionEvent",
      count: { $sum: 1 },
      firstRecordId: { $first: "$_id" },
      lastRecordId: { $last: "$_id" },
    },
  },
  { $match: { count: { $gt: 1 } } },
  { $sort: { count: -1, _id: 1 } },
  { $limit: CONFLICT_REPORT_LIMIT },
];

function formatConflicts(label, conflicts) {
  return conflicts.map(
    ({ _id, count, firstRecordId, lastRecordId }) =>
      `${label} ${_id}: ${count} active records (sample IDs ${firstRecordId}, ${lastRecordId})`
  );
}

async function ensureCongestionLifecycleIndexes({
  congestionEventModel = CongestionEvent,
  trafficAlertModel = TrafficAlert,
  logger = console,
} = {}) {
  const [eventConflicts, alertConflicts] = await Promise.all([
    congestionEventModel.aggregate(ACTIVE_EVENT_CONFLICT_PIPELINE),
    trafficAlertModel.aggregate(ACTIVE_ALERT_CONFLICT_PIPELINE),
  ]);

  if (eventConflicts.length || alertConflicts.length) {
    const details = [
      ...formatConflicts("location", eventConflicts),
      ...formatConflicts("congestion event", alertConflicts),
    ];
    const error = new Error(
      [
        "Refusing to create congestion lifecycle unique indexes because existing active records conflict.",
        `Reported up to ${CONFLICT_REPORT_LIMIT} groups per collection; no records were changed.`,
        ...details,
        "Resolve conflicts through a reviewed, explicit data migration, then restart.",
      ].join("\n")
    );
    logger.error(error.message);
    throw error;
  }

  try {
    await Promise.all([
      congestionEventModel.createIndexes(),
      trafficAlertModel.createIndexes(),
    ]);
  } catch (error) {
    logger.error(
      "Failed to create congestion lifecycle indexes; startup must not continue:",
      error
    );
    throw error;
  }
}

module.exports = {
  ensureCongestionLifecycleIndexes,
  ACTIVE_EVENT_CONFLICT_PIPELINE,
  ACTIVE_ALERT_CONFLICT_PIPELINE,
};
