const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const {
  validateDatabaseSafety,
  parseArgs,
  analyzeLocationConflict,
  evaluateCheckpoints,
  buildMigrationPlan,
  createBackupFile,
  restoreFromBackupFile,
  executeMigration,
  verifyPostMigration,
  run,
  MigrationConfigurationError,
  MigrationSafetyError,
} = require("../scripts/migrate-congestion-lifecycle");

describe("STM Congestion Lifecycle Migration - Safety Guards & Parsing", () => {
  test("validateDatabaseSafety rejects production environment", () => {
    assert.throws(
      () =>
        validateDatabaseSafety({
          environment: { NODE_ENV: "production", STM_TEST_DATABASE_NAME: "stm_test" },
          connection: { name: "stm_test" },
        }),
      (err) => {
        assert.ok(err instanceof MigrationConfigurationError);
        assert.match(err.message, /NODE_ENV is 'production'/);
        return true;
      }
    );
  });

  test("validateDatabaseSafety rejects non-test database names", () => {
    const invalidNames = ["stm_prod", "stm_live", "production_db", "staging_stm", "stm_main"];
    for (const name of invalidNames) {
      assert.throws(
        () =>
          validateDatabaseSafety({
            environment: { NODE_ENV: "development", STM_TEST_DATABASE_NAME: name },
            connection: { name },
          }),
        (err) => {
          assert.ok(err instanceof MigrationConfigurationError);
          assert.match(err.message, /violates safety rules/);
          return true;
        }
      );
    }
  });

  test("validateDatabaseSafety rejects when connected DB does not match expected DB", () => {
    assert.throws(
      () =>
        validateDatabaseSafety({
          environment: { NODE_ENV: "development", STM_TEST_DATABASE_NAME: "stm_test" },
          connection: { name: "other_test_db" },
        }),
      (err) => {
        assert.ok(err instanceof MigrationConfigurationError);
        assert.match(err.message, /does not match expected test database/);
        return true;
      }
    );
  });

  test("validateDatabaseSafety accepts stm_test in development", () => {
    const result = validateDatabaseSafety({
      environment: { NODE_ENV: "development", STM_TEST_DATABASE_NAME: "stm_test" },
      connection: { name: "stm_test" },
    });
    assert.equal(result, true);
  });

  test("parseArgs defaults to dry-run", () => {
    const opts = parseArgs([]);
    assert.equal(opts.dryRun, true);
    assert.equal(opts.apply, false);
    assert.equal(opts.help, false);
  });

  test("parseArgs parses --apply, --dry-run, and manual survivors", () => {
    const optsApply = parseArgs(["--apply"]);
    assert.equal(optsApply.apply, true);
    assert.equal(optsApply.dryRun, false);

    const optsSurvivor = parseArgs([
      "--manual-survivor",
      "loc1=ev1",
      "--manual-survivor=loc2=ev2",
    ]);
    assert.equal(optsSurvivor.manualSurvivors.get("loc1"), "ev1");
    assert.equal(optsSurvivor.manualSurvivors.get("loc2"), "ev2");

    assert.throws(() => parseArgs(["--manual-survivor", "malformed"]), (err) => {
      assert.match(err.message, /Invalid format/);
      return true;
    });
  });
});

describe("STM Congestion Lifecycle Migration - Survivor Selection & Anomalies", () => {
  const locId = "loc-100";

  test("selects survivor with latest verified measurement when timestamps are consistent", () => {
    const events = [
      {
        _id: "ev-1",
        congestionLevel: "HIGH",
        status: "ACTIVE",
        detectedAt: new Date("2026-10-18T10:00:00Z"),
        createdAt: new Date("2026-10-18T10:00:00Z"),
        measurement: "meas-1",
        description: "Measurement 1",
      },
      {
        _id: "ev-2",
        congestionLevel: "SEVERE",
        status: "ACTIVE",
        detectedAt: new Date("2026-10-18T10:15:00Z"),
        createdAt: new Date("2026-10-18T10:15:00Z"),
        measurement: "meas-2",
        description: "Measurement 2",
      },
    ];

    const measurementsMap = new Map([
      ["meas-1", { _id: "meas-1", measuredAt: new Date("2026-10-18T09:59:50Z") }],
      ["meas-2", { _id: "meas-2", measuredAt: new Date("2026-10-18T10:14:50Z") }],
    ]);

    const alerts = [
      { _id: "al-1", congestionEvent: "ev-1", alertType: "CONGESTION", status: "ACTIVE", message: "Alert 1" },
      { _id: "al-2", congestionEvent: "ev-2", alertType: "CONGESTION", status: "ACTIVE", message: "Alert 2" },
    ];

    const plan = analyzeLocationConflict({
      locationId: locId,
      events,
      measurementsMap,
      alerts,
    });

    assert.equal(plan.hasAnomaly, false);
    assert.equal(plan.status, "RESOLVABLE");
    assert.equal(plan.survivor.eventId, "ev-2");
    assert.equal(plan.supersededEvents.length, 1);
    assert.equal(plan.supersededEvents[0].eventId, "ev-1");
    assert.equal(plan.alertsToResolve.length, 1);
    assert.equal(plan.alertsToResolve[0].alertId, "al-1");
  });

  test("detects timestamp discordance anomaly and flags MANUAL_REVIEW_REQUIRED", () => {
    // Exact anomaly pattern of location 6ad4b316397bf7fc985737d5:
    // Event A (seed): earlier createdAt/detectedAt, but LATER measuredAt
    // Event B (runtime): later createdAt/detectedAt, but EARLIER measuredAt
    const events = [
      {
        _id: "ev-seed",
        congestionLevel: "SEVERE",
        status: "ACTIVE",
        detectedAt: new Date("2026-10-18T11:52:54Z"),
        createdAt: new Date("2026-10-18T11:52:54Z"),
        measurement: "meas-seed",
        description: "STM test seed: central congestion event",
      },
      {
        _id: "ev-runtime",
        congestionLevel: "HIGH",
        status: "ACTIVE",
        detectedAt: new Date("2026-10-18T12:02:33Z"),
        createdAt: new Date("2026-10-18T12:02:33Z"),
        measurement: "meas-runtime",
        description: "HIGH congestion detected based on traffic measurement",
      },
    ];

    const measurementsMap = new Map([
      ["meas-seed", { _id: "meas-seed", measuredAt: new Date("2026-10-18T11:53:41Z") }],
      ["meas-runtime", { _id: "meas-runtime", measuredAt: new Date("2026-10-18T11:30:00Z") }],
    ]);

    const alerts = [
      { _id: "al-seed", congestionEvent: "ev-seed", status: "ACTIVE" },
      { _id: "al-runtime", congestionEvent: "ev-runtime", status: "ACTIVE" },
    ];

    const plan = analyzeLocationConflict({
      locationId: "6ad4b316397bf7fc985737d5",
      events,
      measurementsMap,
      alerts,
    });

    assert.equal(plan.hasAnomaly, true);
    assert.equal(plan.status, "MANUAL_REVIEW_REQUIRED");
    assert.match(plan.anomalyReason, /Discordant timestamps/);
    assert.equal(plan.survivor, null);
    assert.equal(plan.supersededEvents.length, 0); // No automated superseded events without confirmed survivor
  });

  test("applies operator manual override for anomalous location", () => {
    const events = [
      {
        _id: "ev-seed",
        congestionLevel: "SEVERE",
        status: "ACTIVE",
        detectedAt: new Date("2026-10-18T11:52:54Z"),
        createdAt: new Date("2026-10-18T11:52:54Z"),
        measurement: "meas-seed",
        description: "STM test seed",
      },
      {
        _id: "ev-runtime",
        congestionLevel: "HIGH",
        status: "ACTIVE",
        detectedAt: new Date("2026-10-18T12:02:33Z"),
        createdAt: new Date("2026-10-18T12:02:33Z"),
        measurement: "meas-runtime",
        description: "Runtime detection",
      },
    ];

    const measurementsMap = new Map([
      ["meas-seed", { _id: "meas-seed", measuredAt: new Date("2026-10-18T11:53:41Z") }],
      ["meas-runtime", { _id: "meas-runtime", measuredAt: new Date("2026-10-18T11:30:00Z") }],
    ]);

    const alerts = [
      { _id: "al-seed", congestionEvent: "ev-seed", status: "ACTIVE" },
      { _id: "al-runtime", congestionEvent: "ev-runtime", status: "ACTIVE" },
    ];

    const manualSurvivors = new Map([["loc-anomaly", "ev-runtime"]]);

    const plan = analyzeLocationConflict({
      locationId: "loc-anomaly",
      events,
      measurementsMap,
      alerts,
      manualSurvivors,
    });

    assert.equal(plan.status, "MANUAL_OVERRIDE_APPLIED");
    assert.equal(plan.survivor.eventId, "ev-runtime");
    assert.equal(plan.supersededEvents.length, 1);
    assert.equal(plan.supersededEvents[0].eventId, "ev-seed");
    assert.equal(plan.alertsToResolve.length, 1);
    assert.equal(plan.alertsToResolve[0].alertId, "al-seed");
  });

  test("rejects invalid manual survivor choice not in group", () => {
    const events = [{ _id: "ev-1", status: "ACTIVE", congestionLevel: "HIGH" }];
    assert.throws(
      () =>
        analyzeLocationConflict({
          locationId: "loc-1",
          events,
          measurementsMap: new Map(),
          manualSurvivors: new Map([["loc-1", "non-existent-ev"]]),
        }),
      (err) => {
        assert.ok(err instanceof MigrationSafetyError);
        assert.match(err.message, /does not match any active event/);
        return true;
      }
    );
  });

  test("resolves duplicate active alerts on the survivor event", () => {
    const events = [
      {
        _id: "ev-survivor",
        congestionLevel: "SEVERE",
        status: "ACTIVE",
        detectedAt: new Date("2026-10-18T10:00:00Z"),
        createdAt: new Date("2026-10-18T10:00:00Z"),
        measurement: "meas-1",
      },
    ];

    const measurementsMap = new Map([
      ["meas-1", { _id: "meas-1", measuredAt: new Date("2026-10-18T10:00:00Z") }],
    ]);

    // Two active alerts attached to the same event
    const alerts = [
      { _id: "al-old", congestionEvent: "ev-survivor", status: "ACTIVE", createdAt: new Date("2026-10-18T10:00:00Z") },
      { _id: "al-new", congestionEvent: "ev-survivor", status: "ACTIVE", createdAt: new Date("2026-10-18T10:05:00Z") },
    ];

    const plan = analyzeLocationConflict({
      locationId: "loc-dup-alerts",
      events,
      measurementsMap,
      alerts,
    });

    assert.equal(plan.alertsToResolve.length, 1);
    assert.equal(plan.alertsToResolve[0].alertId, "al-old");
    assert.match(plan.alertsToResolve[0].reason, /Duplicate active alert on survivor event/);
  });
});

describe("STM Congestion Lifecycle Migration - Checkpoint Evaluation", () => {
  test("passes when active checkpoints reference unrelated events", () => {
    const checkpoints = [
      {
        _id: "cp-1",
        processing: { status: "PROCESSING", stage: "DETECTION_COMPLETED", eventId: "ev-clean" },
      },
    ];

    const result = evaluateCheckpoints({
      checkpoints,
      supersededEventIds: new Set(["ev-superseded"]),
      supersededAlertIds: new Set(["al-superseded"]),
    });

    assert.equal(result.isSafe, true);
    assert.equal(result.checkpointConflicts.length, 0);
  });

  test("aborts when active checkpoint references a superseded event or alert", () => {
    const checkpoints = [
      {
        _id: "meas-conflict-1",
        processing: {
          status: "RETRY",
          stage: "DETECTION_COMPLETED",
          eventId: "ev-superseded-123",
        },
      },
      {
        _id: "meas-conflict-2",
        processing: {
          status: "PENDING",
          stage: "ALERT_COMPLETED",
          alertId: "al-superseded-456",
        },
      },
    ];

    const result = evaluateCheckpoints({
      checkpoints,
      supersededEventIds: new Set(["ev-superseded-123"]),
      supersededAlertIds: new Set(["al-superseded-456"]),
    });

    assert.equal(result.isSafe, false);
    assert.equal(result.checkpointConflicts.length, 2);
    assert.equal(result.checkpointConflicts[0].measurementId, "meas-conflict-1");
    assert.equal(result.checkpointConflicts[1].measurementId, "meas-conflict-2");
  });
});

describe("STM Congestion Lifecycle Migration - Backup & Verification", () => {
  test("createBackupFile writes valid JSON and verifies disk contents", () => {
    const mockFiles = new Map();
    const mockFs = {
      existsSync(p) {
        return mockFiles.has(p) || p.endsWith("backups");
      },
      mkdirSync() {},
      writeFileSync(p, content) {
        mockFiles.set(p, content);
      },
      readFileSync(p) {
        return mockFiles.get(p);
      },
      statSync(p) {
        const c = mockFiles.get(p) || "";
        return { size: Buffer.byteLength(c) };
      },
    };

    const events = [{ _id: "ev-1", status: "ACTIVE" }, { _id: "ev-2", status: "ACTIVE" }];
    const alerts = [{ _id: "al-1", status: "ACTIVE" }];

    const result = createBackupFile({
      backupDir: "/mock/backups",
      eventsToBackup: events,
      alertsToBackup: alerts,
      metadata: { databaseName: "stm_test" },
      fsModule: mockFs,
    });

    assert.ok(result.filePath.includes("congestion-lifecycle-migration-"));
    assert.equal(result.eventCount, 2);
    assert.equal(result.alertCount, 1);
    assert.ok(result.size > 0);

    const parsed = JSON.parse(mockFs.readFileSync(result.filePath));
    assert.equal(parsed.metadata.targetDatabase, "stm_test");
    assert.equal(parsed.affectedRecords.congestionEvents.length, 2);
    assert.equal(parsed.affectedRecords.trafficAlerts.length, 1);
  });

  test("createBackupFile throws if write verification fails (e.g. 0 bytes)", () => {
    const mockFs = {
      existsSync() { return true; },
      mkdirSync() {},
      writeFileSync() {},
      readFileSync() { return "{}"; },
      statSync() { return { size: 0 }; },
    };

    assert.throws(
      () =>
        createBackupFile({
          backupDir: "/mock/backups",
          eventsToBackup: [{ _id: "ev-1" }],
          alertsToBackup: [],
          fsModule: mockFs,
        }),
      (err) => {
        assert.ok(err instanceof MigrationSafetyError);
        assert.match(err.message, /0 bytes/);
        return true;
      }
    );
  });

  test("restoreFromBackupFile restores events and alerts from backup", async () => {
    const backupContent = JSON.stringify({
      affectedRecords: {
        congestionEvents: [
          { _id: "ev-1", status: "ACTIVE" },
          { _id: "ev-2", status: "RESOLVED", resolvedAt: "2026-10-18T12:00:00Z" },
        ],
        trafficAlerts: [
          { _id: "al-1", status: "ACTIVE" },
        ],
      },
    });

    const mockFs = {
      existsSync() { return true; },
      readFileSync() { return backupContent; },
    };

    const updatedEvents = [];
    const mockEventModel = {
      async updateOne(filter, update) {
        updatedEvents.push({ filter, update });
      },
    };

    const updatedAlerts = [];
    const mockAlertModel = {
      async updateOne(filter, update) {
        updatedAlerts.push({ filter, update });
      },
    };

    const result = await restoreFromBackupFile({
      backupPath: "/mock/backup.json",
      congestionEventModel: mockEventModel,
      trafficAlertModel: mockAlertModel,
      fsModule: mockFs,
      logger: { log() {} },
    });

    assert.equal(result.restoredEvents, 2);
    assert.equal(result.restoredAlerts, 1);
    assert.equal(updatedEvents[0].update.$set.status, "ACTIVE");
    assert.ok(updatedEvents[0].update.$unset.resolvedAt);
    assert.equal(updatedEvents[1].update.$set.status, "RESOLVED");
    assert.equal(updatedEvents[1].update.$set.resolvedAt, "2026-10-18T12:00:00Z");
  });
});

describe("STM Congestion Lifecycle Migration - Execution & Rollback", () => {
  test("executeMigration resolves records non-destructively via session transaction", async () => {
    const eventUpdates = [];
    const alertUpdates = [];

    const mockEventModel = {
      async updateMany(filter, update, options) {
        eventUpdates.push({ filter, update, options });
      },
    };
    const mockAlertModel = {
      async updateMany(filter, update, options) {
        alertUpdates.push({ filter, update, options });
      },
    };

    const mockSession = {
      async withTransaction(fn) {
        return fn();
      },
      async endSession() {},
    };

    const mockMongoose = {
      models: { CongestionEvent: mockEventModel, TrafficAlert: mockAlertModel },
      async startSession() {
        return mockSession;
      },
    };

    const eventsToResolve = [{ eventId: "ev-10" }, { eventId: "ev-11" }];
    const alertsToResolve = [{ alertId: "al-10" }];

    const result = await executeMigration({
      mongooseInstance: mockMongoose,
      eventsToResolve,
      alertsToResolve,
      logger: { log() {}, error() {}, warn() {} },
    });

    assert.equal(result.applied, true);
    assert.equal(result.mode, "TRANSACTION");
    assert.equal(result.eventsResolved, 2);
    assert.equal(result.alertsResolved, 1);

    assert.equal(eventUpdates[0].update.$set.status, "RESOLVED");
    assert.ok(eventUpdates[0].update.$set.resolvedAt instanceof Date);
    assert.equal(alertUpdates[0].update.$set.status, "RESOLVED");
  });

  test("executeMigration rolls back sequential updates on failure when transactions unavailable", async () => {
    const appliedUpdates = [];
    const rolledBackUpdates = [];

    let failOnSecondEvent = false;

    const mockEventModel = {
      async updateOne(filter, update) {
        if (update.$set?.status === "RESOLVED") {
          if (filter._id === "ev-fail") {
            throw new Error("Simulated database disk failure");
          }
          appliedUpdates.push(filter._id);
        } else {
          rolledBackUpdates.push(filter._id);
        }
      },
    };

    const mockAlertModel = {
      async updateOne() {},
    };

    const mockMongoose = {
      models: { CongestionEvent: mockEventModel, TrafficAlert: mockAlertModel },
      async startSession() {
        throw new Error("Transactions not supported on standalone MongoDB");
      },
    };

    const eventsToResolve = [
      { eventId: "ev-1", rawEvent: { _id: "ev-1", status: "ACTIVE" } },
      { eventId: "ev-fail", rawEvent: { _id: "ev-fail", status: "ACTIVE" } },
    ];

    await assert.rejects(
      executeMigration({
        mongooseInstance: mockMongoose,
        eventsToResolve,
        alertsToResolve: [],
        logger: { log() {}, error() {}, warn() {} },
      }),
      (err) => {
        assert.match(err.message, /Simulated database disk failure/);
        return true;
      }
    );

    // ev-1 was modified, then ev-fail failed, so ev-1 must have been rolled back
    assert.deepEqual(appliedUpdates, ["ev-1"]);
    assert.deepEqual(rolledBackUpdates, ["ev-1"]);
  });

  test("verifyPostMigration passes when 0 conflicts remain and indexes create successfully", async () => {
    let indexesCreated = false;
    const mockEventModel = {
      async aggregate() {
        return [];
      },
      async createIndexes() {
        indexesCreated = true;
      },
      schema: { indexes: () => [] },
    };
    const mockAlertModel = {
      async aggregate() {
        return [];
      },
      async createIndexes() {
        indexesCreated = true;
      },
      schema: { indexes: () => [] },
    };

    const result = await verifyPostMigration({
      congestionEventModel: mockEventModel,
      trafficAlertModel: mockAlertModel,
      logger: { log() {}, error() {} },
    });

    assert.equal(result.verified, true);
    assert.equal(indexesCreated, true);
  });

  test("verifyPostMigration throws if conflicts still remain", async () => {
    const mockEventModel = {
      async aggregate() {
        return [{ _id: "loc-1", count: 2 }];
      },
    };
    const mockAlertModel = {
      async aggregate() {
        return [];
      },
    };

    await assert.rejects(
      verifyPostMigration({
        congestionEventModel: mockEventModel,
        trafficAlertModel: mockAlertModel,
        logger: { log() {}, error() {} },
      }),
      (err) => {
        assert.ok(err instanceof MigrationSafetyError);
        assert.match(err.message, /Post-migration verification failed/);
        return true;
      }
    );
  });
});

describe("STM Congestion Lifecycle Migration - Pre-Apply Drift & Guard Orchestration", () => {
  test("run with dry-run performs 0 database writes and leaves database untouched", async () => {
    let writeAttempted = false;

    const mockEventModel = {
      async aggregate() {
        return [{ _id: "loc-1", count: 2 }];
      },
      find() {
        return {
          lean: async () => [
            { _id: "ev-1", location: "loc-1", status: "ACTIVE", measurement: "m-1", detectedAt: new Date() },
            { _id: "ev-2", location: "loc-1", status: "ACTIVE", measurement: "m-2", detectedAt: new Date() },
          ],
        };
      },
      async updateMany() { writeAttempted = true; },
      async updateOne() { writeAttempted = true; },
      async deleteMany() { writeAttempted = true; },
    };

    const mockAlertModel = {
      async aggregate() { return []; },
      find() { return { lean: async () => [] }; },
      async updateMany() { writeAttempted = true; },
      async updateOne() { writeAttempted = true; },
    };

    const mockMeasModel = {
      find() {
        return {
          lean: async () => [
            { _id: "m-1", measuredAt: new Date("2026-10-18T10:00:00Z") },
            { _id: "m-2", measuredAt: new Date("2026-10-18T10:05:00Z") },
          ],
        };
      },
    };

    const mockMongoose = {
      connect: async () => {},
      disconnect: async () => {},
      connection: { name: "stm_test" },
      models: {
        CongestionEvent: mockEventModel,
        TrafficAlert: mockAlertModel,
        TrafficMeasurement: mockMeasModel,
      },
    };

    const result = await run({
      args: ["--dry-run"],
      environment: { NODE_ENV: "development", MONGO_URI: "mongodb://127.0.0.1:27017/stm_test", STM_TEST_DATABASE_NAME: "stm_test" },
      mongooseInstance: mockMongoose,
      logger: { log() {}, warn() {}, error() {} },
    });

    assert.equal(result.dryRun, true);
    assert.equal(writeAttempted, false);
    assert.equal(result.plan.conflictingLocationsCount, 1);
  });

  test("run with --apply aborts immediately if timestamp anomalies remain unresolved", async () => {
    let writeAttempted = false;

    const mockEventModel = {
      async aggregate() {
        return [{ _id: "6ad4b316397bf7fc985737d5", count: 2 }];
      },
      find() {
        return {
          lean: async () => [
            // Discordant timestamps (seeded vs runtime)
            {
              _id: "ev-seed",
              location: "6ad4b316397bf7fc985737d5",
              status: "ACTIVE",
              measurement: "m-seed",
              detectedAt: new Date("2026-10-18T11:52:54Z"),
              createdAt: new Date("2026-10-18T11:52:54Z"),
            },
            {
              _id: "ev-runtime",
              location: "6ad4b316397bf7fc985737d5",
              status: "ACTIVE",
              measurement: "m-runtime",
              detectedAt: new Date("2026-10-18T12:02:33Z"),
              createdAt: new Date("2026-10-18T12:02:33Z"),
            },
          ],
        };
      },
      async updateMany() { writeAttempted = true; },
    };

    const mockAlertModel = {
      async aggregate() { return []; },
      find() { return { lean: async () => [] }; },
    };

    const mockMeasModel = {
      find(filter) {
        if (filter?._id?.$in) {
          return {
            lean: async () => [
              { _id: "m-seed", measuredAt: new Date("2026-10-18T11:53:41Z") },
              { _id: "m-runtime", measuredAt: new Date("2026-10-18T11:30:00Z") },
            ],
          };
        }
        return { lean: async () => [] };
      },
    };

    const mockMongoose = {
      connect: async () => {},
      disconnect: async () => {},
      connection: { name: "stm_test" },
      models: {
        CongestionEvent: mockEventModel,
        TrafficAlert: mockAlertModel,
        TrafficMeasurement: mockMeasModel,
      },
    };

    await assert.rejects(
      run({
        args: ["--apply"],
        environment: { NODE_ENV: "development", MONGO_URI: "mongodb://127.0.0.1:27017/stm_test", STM_TEST_DATABASE_NAME: "stm_test" },
        mongooseInstance: mockMongoose,
        logger: { log() {}, warn() {}, error() {} },
      }),
      (err) => {
        assert.ok(err instanceof MigrationSafetyError);
        assert.match(err.message, /Timestamp anomaly detected/);
        return true;
      }
    );

    assert.equal(writeAttempted, false);
  });

  test("run with --apply aborts if database state drifts between plan and apply", async () => {
    let writeAttempted = false;
    let queryCount = 0;

    const mockEventModel = {
      async aggregate() {
        queryCount++;
        // On second query (pre-apply recalculation), another conflict appeared!
        if (queryCount > 1) {
          return [{ _id: "loc-1", count: 3 }, { _id: "loc-2", count: 2 }];
        }
        return [{ _id: "loc-1", count: 2 }];
      },
      find() {
        return {
          lean: async () => [
            { _id: "ev-1", location: "loc-1", status: "ACTIVE", measurement: "m-1", detectedAt: new Date() },
            { _id: "ev-2", location: "loc-1", status: "ACTIVE", measurement: "m-2", detectedAt: new Date() },
          ],
        };
      },
      async updateMany() { writeAttempted = true; },
      async createIndexes() {},
      schema: { indexes: () => [] },
    };

    const mockAlertModel = {
      async aggregate() { return []; },
      find() { return { lean: async () => [] }; },
      async updateMany() { writeAttempted = true; },
      async createIndexes() {},
      schema: { indexes: () => [] },
    };

    const mockMeasModel = {
      find(filter) {
        if (filter?._id?.$in) {
          return {
            lean: async () => [
              { _id: "m-1", measuredAt: new Date("2026-10-18T10:00:00Z") },
              { _id: "m-2", measuredAt: new Date("2026-10-18T10:05:00Z") },
            ],
          };
        }
        return { lean: async () => [] };
      },
    };

    const mockMongoose = {
      connect: async () => {},
      disconnect: async () => {},
      connection: { name: "stm_test" },
      models: {
        CongestionEvent: mockEventModel,
        TrafficAlert: mockAlertModel,
        TrafficMeasurement: mockMeasModel,
      },
    };

    await assert.rejects(
      run({
        args: ["--apply"],
        environment: { NODE_ENV: "development", MONGO_URI: "mongodb://127.0.0.1:27017/stm_test", STM_TEST_DATABASE_NAME: "stm_test" },
        mongooseInstance: mockMongoose,
        logger: { log() {}, warn() {}, error() {} },
      }),
      (err) => {
        assert.ok(err instanceof MigrationSafetyError);
        assert.match(err.message, /Pre-apply drift check failed/);
        return true;
      }
    );

    assert.equal(writeAttempted, false);
  });

  test("run with --apply aborts before write if backup creation fails", async () => {
    let writeAttempted = false;

    const mockEventModel = {
      async aggregate() {
        return [{ _id: "loc-1", count: 2 }];
      },
      find() {
        return {
          lean: async () => [
            { _id: "ev-1", location: "loc-1", status: "ACTIVE", measurement: "m-1", detectedAt: new Date() },
            { _id: "ev-2", location: "loc-1", status: "ACTIVE", measurement: "m-2", detectedAt: new Date() },
          ],
        };
      },
      async updateMany() { writeAttempted = true; },
    };

    const mockAlertModel = {
      async aggregate() { return []; },
      find() { return { lean: async () => [] }; },
      async updateMany() { writeAttempted = true; },
    };

    const mockMeasModel = {
      find(filter) {
        if (filter?._id?.$in) {
          return {
            lean: async () => [
              { _id: "m-1", measuredAt: new Date("2026-10-18T10:00:00Z") },
              { _id: "m-2", measuredAt: new Date("2026-10-18T10:05:00Z") },
            ],
          };
        }
        return { lean: async () => [] };
      },
    };

    const mockFs = {
      existsSync() { return false; }, // Fails file existence check after write
      mkdirSync() {},
      writeFileSync() {},
    };

    const mockMongoose = {
      connect: async () => {},
      disconnect: async () => {},
      connection: { name: "stm_test" },
      models: {
        CongestionEvent: mockEventModel,
        TrafficAlert: mockAlertModel,
        TrafficMeasurement: mockMeasModel,
      },
    };

    await assert.rejects(
      run({
        args: ["--apply"],
        environment: { NODE_ENV: "development", MONGO_URI: "mongodb://127.0.0.1:27017/stm_test", STM_TEST_DATABASE_NAME: "stm_test" },
        mongooseInstance: mockMongoose,
        fsModule: mockFs,
        logger: { log() {}, warn() {}, error() {} },
      }),
      (err) => {
        assert.ok(err instanceof MigrationSafetyError);
        assert.match(err.message, /Backup write verification failed/);
        return true;
      }
    );

    assert.equal(writeAttempted, false);
  });

  test("run with --apply succeeds when clean or manual override provided, creating backup and satisfying invariants", async () => {
    let writeAttempted = false;
    let postAggregateCount = 0;
    const mockFiles = new Map();

    const mockEventModel = {
      async aggregate() {
        postAggregateCount++;
        // Once migration applied, aggregate returns 0 conflicts
        if (postAggregateCount > 2) {
          return [];
        }
        return [{ _id: "loc-1", count: 2 }];
      },
      find() {
        return {
          lean: async () => [
            { _id: "ev-1", location: "loc-1", status: "ACTIVE", measurement: "m-1", detectedAt: new Date("2026-10-18T10:00:00Z") },
            { _id: "ev-2", location: "loc-1", status: "ACTIVE", measurement: "m-2", detectedAt: new Date("2026-10-18T10:05:00Z") },
          ],
        };
      },
      async updateMany() { writeAttempted = true; },
      async createIndexes() {},
      schema: { indexes: () => [] },
    };

    const mockAlertModel = {
      async aggregate() { return []; },
      find() { return { lean: async () => [] }; },
      async updateMany() { writeAttempted = true; },
      async createIndexes() {},
      schema: { indexes: () => [] },
    };

    const mockMeasModel = {
      find(filter) {
        if (filter?._id?.$in) {
          return {
            lean: async () => [
              { _id: "m-1", measuredAt: new Date("2026-10-18T10:00:00Z") },
              { _id: "m-2", measuredAt: new Date("2026-10-18T10:05:00Z") },
            ],
          };
        }
        return { lean: async () => [] };
      },
    };

    const mockFs = {
      existsSync(p) { return mockFiles.has(p) || p.endsWith("backups"); },
      mkdirSync() {},
      writeFileSync(p, c) { mockFiles.set(p, c); },
      readFileSync(p) { return mockFiles.get(p); },
      statSync(p) { return { size: Buffer.byteLength(mockFiles.get(p) || "") }; },
    };

    const mockSession = {
      async withTransaction(fn) { return fn(); },
      async endSession() {},
    };

    const mockMongoose = {
      connect: async () => {},
      disconnect: async () => {},
      connection: { name: "stm_test" },
      models: {
        CongestionEvent: mockEventModel,
        TrafficAlert: mockAlertModel,
        TrafficMeasurement: mockMeasModel,
      },
      startSession: async () => mockSession,
    };

    const result = await run({
      args: ["--apply"],
      environment: { NODE_ENV: "development", MONGO_URI: "mongodb://127.0.0.1:27017/stm_test", STM_TEST_DATABASE_NAME: "stm_test" },
      mongooseInstance: mockMongoose,
      fsModule: mockFs,
      logger: { log() {}, warn() {}, error() {} },
    });

    assert.equal(result.applied, true);
    assert.equal(writeAttempted, true);
    assert.equal(result.execution.eventsResolved, 1);
    assert.ok(result.backup.size > 0);
  });
});
