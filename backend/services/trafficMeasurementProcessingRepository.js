const TrafficMeasurement = require("../models/TrafficMeasurement");
const TrafficMeasurementProcessingLease = require("../models/TrafficMeasurementProcessingLease");

const ACTIVE_PROCESSING_STATUSES = ["PENDING", "RETRY", "PROCESSING"];

function isDuplicateKeyError(error) {
  return error?.code === 11000;
}

async function acquireLocationLease(locationId, token, now, expiresAt) {
  try {
    const lease = await TrafficMeasurementProcessingLease.findOneAndUpdate(
      {
        _id: locationId,
        $or: [
          { expiresAt: { $lte: now } },
          { expiresAt: { $exists: false } },
        ],
      },
      { $set: { token, expiresAt } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return lease?.token === token;
  } catch (error) {
    if (isDuplicateKeyError(error)) return false;
    throw error;
  }
}

async function findLocationHead(locationId) {
  return TrafficMeasurement.findOne({
    location: locationId,
    "processing.status": { $in: ACTIVE_PROCESSING_STATUSES },
  })
    .select("+processing +processing.leaseToken")
    .sort({ createdAt: 1, _id: 1 })
    .lean();
}

async function claimMeasurement(measurementId, token, now, expiresAt, maxAttempts) {
  return TrafficMeasurement.findOneAndUpdate(
    {
      _id: measurementId,
      "processing.attempts": { $lt: maxAttempts },
      $or: [
        { "processing.status": "PENDING" },
        {
          "processing.status": "RETRY",
          $or: [
            { "processing.nextAttemptAt": { $exists: false } },
            { "processing.nextAttemptAt": null },
            { "processing.nextAttemptAt": { $lte: now } },
          ],
        },
        {
          "processing.status": "PROCESSING",
          $or: [
            { "processing.leaseUntil": { $exists: false } },
            { "processing.leaseUntil": null },
            { "processing.leaseUntil": { $lte: now } },
          ],
        },
      ],
    },
    {
      $set: {
        "processing.status": "PROCESSING",
        "processing.leaseToken": token,
        "processing.leaseUntil": expiresAt,
      },
      $inc: { "processing.attempts": 1 },
      $unset: {
        "processing.nextAttemptAt": "",
        "processing.lastError": "",
      },
    },
    {
      new: true,
      runValidators: true,
    }
  )
    .select("+processing +processing.leaseToken")
    .lean();
}

async function markExhausted(measurementId, now, lastError) {
  const result = await TrafficMeasurement.updateOne(
    {
      _id: measurementId,
      "processing.attempts": { $gte: 8 },
      $or: [
        {
          "processing.status": "PROCESSING",
          $or: [
            { "processing.leaseUntil": { $exists: false } },
            { "processing.leaseUntil": null },
            { "processing.leaseUntil": { $lte: now } },
          ],
        },
        {
          "processing.status": "RETRY",
          $or: [
            { "processing.nextAttemptAt": { $exists: false } },
            { "processing.nextAttemptAt": null },
            { "processing.nextAttemptAt": { $lte: now } },
          ],
        },
      ],
    },
    {
      $set: {
        "processing.status": "FAILED",
        "processing.lastError": lastError,
      },
      $unset: {
        "processing.leaseToken": "",
        "processing.leaseUntil": "",
        "processing.nextAttemptAt": "",
      },
    }
  );
  return result.modifiedCount === 1;
}

async function renewLeases(locationId, measurementId, token, expiresAt) {
  const [locationResult, measurementResult] = await Promise.all([
    TrafficMeasurementProcessingLease.updateOne(
      { _id: locationId, token },
      { $set: { expiresAt } }
    ),
    TrafficMeasurement.updateOne(
      { _id: measurementId, "processing.leaseToken": token },
      { $set: { "processing.leaseUntil": expiresAt } }
    ),
  ]);

  if (locationResult.matchedCount !== 1 || measurementResult.matchedCount !== 1) {
    throw new Error("Traffic processing lease was lost");
  }
}

async function checkpoint(
  measurementId,
  token,
  { stage, eventId, alertId, alertCreated, message }
) {
  const values = { "processing.stage": stage };
  if (eventId !== undefined) values["processing.eventId"] = eventId;
  if (alertId !== undefined) values["processing.alertId"] = alertId;
  if (alertCreated !== undefined) {
    values["processing.result.alertCreated"] = alertCreated;
  }
  if (message !== undefined) values["processing.result.message"] = message;
  const result = await TrafficMeasurement.updateOne(
    { _id: measurementId, "processing.leaseToken": token },
    { $set: values }
  );
  if (result.matchedCount !== 1) {
    throw new Error("Traffic processing lease was lost before stage checkpoint");
  }
}

async function complete(measurementId, token, completedAt, result) {
  const values = {
    "processing.status": "COMPLETED",
    "processing.completedAt": completedAt,
  };
  for (const key of [
    "congestionDetected",
    "congestionLevel",
    "alertCreated",
    "message",
  ]) {
    if (result[key] !== undefined) values[`processing.result.${key}`] = result[key];
  }
  const updateResult = await TrafficMeasurement.updateOne(
    { _id: measurementId, "processing.leaseToken": token },
    {
      $set: values,
      $unset: {
        "processing.leaseToken": "",
        "processing.leaseUntil": "",
        "processing.nextAttemptAt": "",
        "processing.lastError": "",
      },
    }
  );
  if (updateResult.matchedCount !== 1) {
    throw new Error("Traffic processing lease was lost before completion");
  }
}

async function fail(measurementId, token, { status, nextAttemptAt, lastError }) {
  const values = {
    "processing.status": status,
    "processing.lastError": lastError,
  };
  if (nextAttemptAt) values["processing.nextAttemptAt"] = nextAttemptAt;
  const result = await TrafficMeasurement.updateOne(
    { _id: measurementId, "processing.leaseToken": token },
    {
      $set: values,
      $unset: {
        "processing.leaseToken": "",
        "processing.leaseUntil": "",
      },
    }
  );
  if (result.matchedCount !== 1) {
    throw new Error("Traffic processing lease was lost before failure state was saved");
  }
}

async function releaseLocationLease(locationId, token, now) {
  await TrafficMeasurementProcessingLease.updateOne(
    { _id: locationId, token },
    { $set: { expiresAt: now } }
  );
}

async function findReadyLocationHeads(now, limit) {
  return TrafficMeasurement.aggregate([
    {
      $match: {
        "processing.status": { $in: ACTIVE_PROCESSING_STATUSES },
      },
    },
    { $sort: { createdAt: 1, _id: 1 } },
    {
      $group: {
        _id: "$location",
        head: {
          $first: {
            measurementId: "$_id",
            status: "$processing.status",
            nextAttemptAt: "$processing.nextAttemptAt",
            leaseUntil: "$processing.leaseUntil",
            createdAt: "$createdAt",
          },
        },
      },
    },
    {
      $match: {
        $or: [
          { "head.status": "PENDING" },
          {
            "head.status": "RETRY",
            $or: [
              { "head.nextAttemptAt": { $exists: false } },
              { "head.nextAttemptAt": null },
              { "head.nextAttemptAt": { $lte: now } },
            ],
          },
          {
            "head.status": "PROCESSING",
            $or: [
              { "head.leaseUntil": { $exists: false } },
              { "head.leaseUntil": null },
              { "head.leaseUntil": { $lte: now } },
            ],
          },
        ],
      },
    },
    { $sort: { "head.createdAt": 1, _id: 1 } },
    { $limit: limit },
  ]);
}

async function getMeasurement(measurementId) {
  return TrafficMeasurement.findById(measurementId)
    .select("+processing +processing.leaseToken")
    .lean();
}

async function ensureIndexes() {
  await TrafficMeasurement.createIndexes();
}

module.exports = {
  acquireLocationLease,
  checkpoint,
  claimMeasurement,
  complete,
  ensureIndexes,
  fail,
  findLocationHead,
  findReadyLocationHeads,
  getMeasurement,
  markExhausted,
  releaseLocationLease,
  renewLeases,
};
