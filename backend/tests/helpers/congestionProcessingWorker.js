const mongoose = require("mongoose");
const {
  assertConnectedDatabaseName,
  validateIntegrationEnvironment,
} = require("../../scripts/seed-test-data");

async function waitForPeer(stage) {
  const barrier = mongoose.connection.collection(
    "stm_congestion_insert_barriers"
  );
  const barrierId = process.env.STM_IT_BARRIER_ID;
  const workerId = process.env.STM_IT_WORKER_ID;
  const ids = [0, 1].map(
    (id) => `${barrierId}:${stage}:${id}`
  );
  const ownId = `${barrierId}:${stage}:${workerId}`;
  await barrier.updateOne(
    { _id: ownId },
    { $setOnInsert: { stage, workerId, createdAt: new Date() } },
    { upsert: true }
  );

  const deadline = Date.now() + 30000;
  while ((await barrier.countDocuments({ _id: { $in: ids } })) < 2) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for peer at ${stage} insert barrier.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function start() {
  const configuration = validateIntegrationEnvironment(process.env);

  await mongoose.connect(configuration.mongoUri, {
    dbName: configuration.databaseName,
    autoIndex: false,
  });
  assertConnectedDatabaseName(
    mongoose.connection.name,
    configuration.databaseName
  );

  if (process.env.STM_IT_RECOVERY_WORKER === "YES") {
    const recoveryWorker =
      require("../../services/trafficMeasurementRecoveryWorker")
        .trafficMeasurementRecoveryWorker;
    if (process.env.STM_IT_START_RECOVERY_WORKER === "YES") {
      await recoveryWorker.start();
    }
    process.send({ type: "ready", processId: process.pid });
    process.once("message", async (message) => {
      if (message?.type !== "start") return;
      try {
        if (process.env.STM_IT_RECOVERY_BARRIER === "YES") {
          await waitForPeer("recovery-claim");
        }
        const value = await recoveryWorker.processMeasurementNow(
          process.env.STM_IT_MEASUREMENT_ID
        );
        await recoveryWorker.stop();
        await new Promise((resolve, reject) => {
          process.send(
            { type: "result", value, processId: process.pid },
            (error) => (error ? reject(error) : resolve())
          );
        });
        await mongoose.disconnect();
        process.exit(0);
      } catch (error) {
        await recoveryWorker.stop();
        await new Promise((resolve) => {
          process.send({ type: "error", message: error.message }, resolve);
        });
        await mongoose.disconnect();
        process.exit(1);
      }
    });
    return;
  }

  const CongestionEvent = require("../../models/CongestionEvent");
  const TrafficAlert = require("../../models/TrafficAlert");
  const saveEvent = CongestionEvent.prototype.save;
  const saveAlert = TrafficAlert.prototype.save;
  CongestionEvent.prototype.save = async function (...args) {
    if (this.status === "ACTIVE") await waitForPeer("event");
    return saveEvent.apply(this, args);
  };
  TrafficAlert.prototype.save = async function (...args) {
    if (this.status === "ACTIVE") await waitForPeer("alert");
    return saveAlert.apply(this, args);
  };
  const processingService = require("../../services/trafficMeasurementProcessingService");
  process.send({ type: "ready", processId: process.pid });

  process.once("message", async (message) => {
    if (message?.type !== "start") return;
    try {
      const value = await processingService.processTrafficMeasurement(
        process.env.STM_IT_MEASUREMENT_ID
      );
      await new Promise((resolve, reject) => {
        process.send({ type: "result", value }, (error) =>
          error ? reject(error) : resolve()
        );
      });
      await mongoose.disconnect();
      process.exit(0);
    } catch (error) {
      await new Promise((resolve) => {
        process.send({ type: "error", message: error.message }, resolve);
      });
      await mongoose.disconnect();
      process.exit(1);
    }
  });
}

start().catch((error) => {
  if (!process.send) {
    console.error(error);
    process.exit(1);
  }
  process.send({ type: "error", message: error.message }, () => process.exit(1));
});
