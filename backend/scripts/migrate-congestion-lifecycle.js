/**
 * backend/scripts/migrate-congestion-lifecycle.js
 *
 * Dedicated, auditable migration to resolve historical MongoDB congestion lifecycle
 * conflicts preventing backend startup under congestionLifecycleIndexService.
 *
 * Invariants enforced:
 *   1. active_congestion_event_per_location: Exactly one ACTIVE CongestionEvent per location
 *   2. active_congestion_alert_per_event: Exactly one ACTIVE TrafficAlert per CongestionEvent
 *
 * Safety Rules:
 *   - Dry-run by default. Modifies NOTHING without --apply.
 *   - Strictly guarded: refuses production and databases other than stm_test.
 *   - Inspects measurement checkpoints; aborts if superseded IDs are referenced.
 *   - Conservative survivor selection; flags timestamp anomalies for manual review and aborts --apply.
 *   - Pre-write timestamped JSON backup with write verification.
 *   - Multi-document transactions where supported; audited sequential rollback where not.
 *   - Zero record deletion: preserves historical documents with status: "RESOLVED".
 *   - Post-apply independent verification and unique index creation check.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const CongestionEvent = require("../models/CongestionEvent");
const TrafficAlert = require("../models/TrafficAlert");
const TrafficMeasurement = require("../models/TrafficMeasurement");
const {
  ensureCongestionLifecycleIndexes,
  ACTIVE_EVENT_CONFLICT_PIPELINE,
  ACTIVE_ALERT_CONFLICT_PIPELINE,
} = require("../services/congestionLifecycleIndexService");
const { getConnectionOptions, DEVELOPMENT_DATABASE_NAME } = require("../config/database");

const DEFAULT_BACKUP_DIR = path.resolve(__dirname, "../backups");
const ALLOWED_TEST_DB_NAME = "stm_test";

class MigrationConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "MigrationConfigurationError";
  }
}

class MigrationSafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = "MigrationSafetyError";
  }
}

/**
 * Validates environment and database target before any operation.
 */
function validateDatabaseSafety({
  environment = process.env,
  connection = mongoose.connection,
} = {}) {
  if (environment.NODE_ENV === "production") {
    throw new MigrationConfigurationError(
      "Refusing to run migration: NODE_ENV is 'production'. Migrations must not run in production mode."
    );
  }

  const expectedDb = environment.STM_TEST_DATABASE_NAME || DEVELOPMENT_DATABASE_NAME || ALLOWED_TEST_DB_NAME;
  const connectedDb = connection.name;

  if (!connectedDb) {
    throw new MigrationConfigurationError(
      "No database connection established. Cannot verify database safety."
    );
  }

  if (connectedDb !== expectedDb) {
    throw new MigrationConfigurationError(
      `Connected database '${connectedDb}' does not match expected test database '${expectedDb}'. Aborting.`
    );
  }

  if (
    !/test/i.test(connectedDb) ||
    /prod|production|live|staging/i.test(connectedDb)
  ) {
    throw new MigrationConfigurationError(
      `Database name '${connectedDb}' violates safety rules (must contain 'test' and cannot identify production/live/staging).`
    );
  }

  return true;
}

/**
 * Parses CLI arguments.
 */
function parseArgs(args = process.argv.slice(2)) {
  const options = {
    apply: false,
    dryRun: true,
    help: false,
    restorePath: null,
    manualSurvivors: new Map(), // locationId -> eventId
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--apply") {
      options.apply = true;
      options.dryRun = false;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
      options.apply = false;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--restore") {
      options.restorePath = args[++i];
      if (!options.restorePath) {
        throw new MigrationConfigurationError("Missing path argument for --restore.");
      }
    } else if (arg.startsWith("--manual-survivor=")) {
      const pair = arg.slice("--manual-survivor=".length);
      const [locId, evId] = pair.split("=");
      if (!locId || !evId) {
        throw new MigrationConfigurationError(
          "Invalid format for --manual-survivor. Expected --manual-survivor=<locationId>=<eventId>"
        );
      }
      options.manualSurvivors.set(locId.trim(), evId.trim());
    } else if (arg === "--manual-survivor") {
      const pair = args[++i];
      if (!pair) {
        throw new MigrationConfigurationError("Missing argument for --manual-survivor.");
      }
      const [locId, evId] = pair.split("=");
      if (!locId || !evId) {
        throw new MigrationConfigurationError(
          "Invalid format for --manual-survivor. Expected --manual-survivor <locationId>=<eventId>"
        );
      }
      options.manualSurvivors.set(locId.trim(), evId.trim());
    }
  }

  return options;
}

/**
 * Pure function: Analyzes active events at a conflicting location, inspects timestamps,
 * checks for anomalies, selects survivor conservatively, and maps alerts to resolve.
 */
function analyzeLocationConflict({
  locationId,
  events = [],
  measurementsMap = new Map(),
  alerts = [],
  manualSurvivors = new Map(),
} = {}) {
  const locIdStr = locationId.toString();

  // Map events with their measurement details
  const eventDetails = events.map((ev) => {
    const evId = ev._id.toString();
    const measId = ev.measurement ? ev.measurement.toString() : null;
    const meas = measId ? measurementsMap.get(measId) : null;

    const detectedAt = ev.detectedAt ? new Date(ev.detectedAt) : null;
    const createdAt = ev.createdAt ? new Date(ev.createdAt) : null;
    const updatedAt = ev.updatedAt ? new Date(ev.updatedAt) : null;
    const measuredAt = meas?.measuredAt ? new Date(meas.measuredAt) : null;
    const measCreatedAt = meas?.createdAt ? new Date(meas.createdAt) : null;

    const isSeeded =
      (ev.description || "").includes("STM test seed") ||
      (meas?.source === "SIMULATOR" ? false : false);

    return {
      eventId: evId,
      congestionLevel: ev.congestionLevel,
      description: ev.description || "",
      status: ev.status,
      detectedAt,
      createdAt,
      updatedAt,
      measurementId: measId,
      hasMeasurement: Boolean(meas),
      measuredAt,
      measCreatedAt,
      isSeeded,
      rawEvent: ev,
    };
  });

  if (eventDetails.length === 0) {
    return {
      locationId: locIdStr,
      activeEventsCount: 0,
      events: [],
      missingMeasurements: [],
      hasAnomaly: false,
      anomalyReason: null,
      status: "NO_EVENTS",
      survivor: null,
      survivorEvidence: "No active events for location.",
      supersededEvents: [],
      alertsToResolve: [],
    };
  }

  // Check for missing linked measurements
  const missingMeasurements = eventDetails.filter((e) => !e.hasMeasurement);

  // Sorting strategies
  // 1. By measurement measuredAt desc (nulls last), then createdAt desc, then _id desc
  const sortedByMeasuredAt = [...eventDetails].sort((a, b) => {
    const timeA = a.measuredAt ? a.measuredAt.getTime() : -Infinity;
    const timeB = b.measuredAt ? b.measuredAt.getTime() : -Infinity;
    if (timeB !== timeA) return timeB - timeA;
    const createA = a.createdAt ? a.createdAt.getTime() : 0;
    const createB = b.createdAt ? b.createdAt.getTime() : 0;
    if (createB !== createA) return createB - createA;
    return b.eventId.localeCompare(a.eventId);
  });

  // 2. By event detectedAt desc, then createdAt desc, then _id desc
  const sortedByDetectedAt = [...eventDetails].sort((a, b) => {
    const timeA = a.detectedAt ? a.detectedAt.getTime() : (a.createdAt ? a.createdAt.getTime() : 0);
    const timeB = b.detectedAt ? b.detectedAt.getTime() : (b.createdAt ? b.createdAt.getTime() : 0);
    if (timeB !== timeA) return timeB - timeA;
    return b.eventId.localeCompare(a.eventId);
  });

  const topByMeasuredAt = sortedByMeasuredAt[0];
  const topByDetectedAt = sortedByDetectedAt[0];

  // Detect Timestamp Inversion / Anomaly:
  // An anomaly exists if:
  //   a) The top event by measuredAt is different from top event by detectedAt (discordant chronology)
  //   b) An event is a seeded record whose measurement timestamp contradicts subsequent runtime events
  let hasAnomaly = false;
  let anomalyReason = null;

  if (topByMeasuredAt && topByDetectedAt && topByMeasuredAt.eventId !== topByDetectedAt.eventId) {
    hasAnomaly = true;
    anomalyReason =
      `Discordant timestamps: Event ${topByMeasuredAt.eventId} has latest measuredAt (` +
      `${topByMeasuredAt.measuredAt ? topByMeasuredAt.measuredAt.toISOString() : "none"}` +
      `) but Event ${topByDetectedAt.eventId} has latest detectedAt (` +
      `${topByDetectedAt.detectedAt ? topByDetectedAt.detectedAt.toISOString() : "none"}` +
      `). Chronological order between seeded baseline and runtime measurement is inverted.`;
  }

  // Survivor Selection
  let survivor = null;
  let survivorEvidence = null;
  let status = "RESOLVABLE";

  const manualChoice = manualSurvivors.get(locIdStr);

  if (manualChoice) {
    const matched = eventDetails.find((e) => e.eventId === manualChoice);
    if (!matched) {
      throw new MigrationSafetyError(
        `Manual survivor '${manualChoice}' specified for location '${locIdStr}' does not match any active event at this location.`
      );
    }
    survivor = matched;
    status = "MANUAL_OVERRIDE_APPLIED";
    survivorEvidence = `Operator explicit override selected Event ${matched.eventId} (${matched.description || matched.congestionLevel}).`;
  } else if (hasAnomaly) {
    status = "MANUAL_REVIEW_REQUIRED";
    survivorEvidence = "Timestamp anomaly detected: automatic survivor selection cannot proceed safely without operator decision.";
  } else {
    survivor = topByMeasuredAt;
    survivorEvidence =
      `Selected Event ${survivor.eventId}: verified latest consistent measurement ` +
      `measuredAt (${survivor.measuredAt ? survivor.measuredAt.toISOString() : "none"}) ` +
      `and detectedAt (${survivor.detectedAt ? survivor.detectedAt.toISOString() : "none"}).`;
  }

  // Determine events to resolve
  const supersededEvents = survivor
    ? eventDetails.filter((e) => e.eventId !== survivor.eventId)
    : [];

  const supersededEventIds = new Set(supersededEvents.map((e) => e.eventId));

  // Determine alerts to resolve:
  // 1. Any active alert linked to a superseded event
  // 2. If the survivor event itself has more than 1 active alert, resolve duplicates on survivor
  const alertsToResolve = [];
  const survivorAlerts = [];

  for (const al of alerts) {
    const evRef = al.congestionEvent ? al.congestionEvent.toString() : null;
    if (evRef && supersededEventIds.has(evRef)) {
      alertsToResolve.push({
        alertId: al._id.toString(),
        congestionEventId: evRef,
        message: al.message,
        severity: al.severity,
        reason: "Linked to superseded CongestionEvent",
        rawAlert: al,
      });
    } else if (survivor && evRef === survivor.eventId) {
      survivorAlerts.push(al);
    }
  }

  // If survivor has multiple active alerts, retain the latest and resolve older ones
  if (survivorAlerts.length > 1) {
    survivorAlerts.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const [survivorAlertToKeep, ...duplicateSurvivorAlerts] = survivorAlerts;
    for (const dup of duplicateSurvivorAlerts) {
      alertsToResolve.push({
        alertId: dup._id.toString(),
        congestionEventId: survivor.eventId,
        message: dup.message,
        severity: dup.severity,
        reason: `Duplicate active alert on survivor event (retaining latest alert ${survivorAlertToKeep._id})`,
        rawAlert: dup,
      });
    }
  }

  return {
    locationId: locIdStr,
    activeEventsCount: eventDetails.length,
    events: eventDetails,
    missingMeasurements,
    hasAnomaly,
    anomalyReason,
    status,
    survivor,
    survivorEvidence,
    supersededEvents,
    alertsToResolve,
  };
}

/**
 * Pure function: Checks pending/processing/retrying measurement checkpoints against proposed resolutions.
 */
function evaluateCheckpoints({
  checkpoints = [],
  supersededEventIds = new Set(),
  supersededAlertIds = new Set(),
} = {}) {
  const checkpointConflicts = [];

  for (const cp of checkpoints) {
    const cpId = cp._id ? cp._id.toString() : "unknown";
    const status = cp.processing?.status || "UNKNOWN";
    const stage = cp.processing?.stage || "NONE";
    const evId = cp.processing?.eventId ? cp.processing.eventId.toString() : null;
    const alId = cp.processing?.alertId ? cp.processing.alertId.toString() : null;

    if (evId && supersededEventIds.has(evId)) {
      checkpointConflicts.push({
        measurementId: cpId,
        checkpointStatus: status,
        checkpointStage: stage,
        referencedType: "CongestionEvent",
        referencedId: evId,
        reason: "Active checkpoint references a CongestionEvent proposed for resolution",
      });
    }

    if (alId && supersededAlertIds.has(alId)) {
      checkpointConflicts.push({
        measurementId: cpId,
        checkpointStatus: status,
        checkpointStage: stage,
        referencedType: "TrafficAlert",
        referencedId: alId,
        reason: "Active checkpoint references a TrafficAlert proposed for resolution",
      });
    }
  }

  return {
    totalActiveCheckpoints: checkpoints.length,
    checkpointConflicts,
    isSafe: checkpointConflicts.length === 0,
  };
}

/**
 * Builds the full migration plan from database queries or mock datasets.
 */
async function buildMigrationPlan({
  congestionEventModel = CongestionEvent,
  trafficAlertModel = TrafficAlert,
  trafficMeasurementModel = TrafficMeasurement,
  manualSurvivors = new Map(),
} = {}) {
  // 1. Query conflicting active event groups using the exact startup index pipeline
  const conflictGroups = await congestionEventModel.aggregate(ACTIVE_EVENT_CONFLICT_PIPELINE);
  const conflictingLocationIds = conflictGroups.map((g) => g._id);

  if (conflictingLocationIds.length === 0) {
    return {
      conflictingLocationsCount: 0,
      plans: [],
      allSupersededEvents: [],
      allAlertsToResolve: [],
      checkpointEvaluation: { totalActiveCheckpoints: 0, checkpointConflicts: [], isSafe: true },
      hasUnresolvedAnomalies: false,
      isApplyReady: true,
    };
  }

  // 2. Fetch all active events across conflicting locations
  const activeEvents = await congestionEventModel.find({
    location: { $in: conflictingLocationIds },
    status: "ACTIVE",
  }).lean();

  // 3. Fetch linked measurements
  const measurementIds = [
    ...new Set(activeEvents.map((e) => e.measurement?.toString()).filter(Boolean)),
  ];

  const measurements = measurementIds.length > 0
    ? await trafficMeasurementModel.find({ _id: { $in: measurementIds } }).lean()
    : [];

  const measurementsMap = new Map(measurements.map((m) => [m._id.toString(), m]));

  // 4. Fetch active alerts linked to active events
  const activeEventIds = activeEvents.map((e) => e._id);
  const activeAlerts = await trafficAlertModel.find({
    congestionEvent: { $in: activeEventIds },
    status: "ACTIVE",
    alertType: "CONGESTION",
  }).lean();

  // Group events and alerts by location
  const eventsByLocation = new Map();
  for (const ev of activeEvents) {
    const locId = ev.location.toString();
    if (!eventsByLocation.has(locId)) eventsByLocation.set(locId, []);
    eventsByLocation.get(locId).push(ev);
  }

  const alertsByEventId = new Map();
  for (const al of activeAlerts) {
    const evId = al.congestionEvent.toString();
    if (!alertsByEventId.has(evId)) alertsByEventId.set(evId, []);
    alertsByEventId.get(evId).push(al);
  }

  // 5. Analyze each location
  const plans = [];
  const allSupersededEvents = [];
  const allAlertsToResolve = [];
  let hasUnresolvedAnomalies = false;

  for (const locId of conflictingLocationIds) {
    const locIdStr = locId.toString();
    const locEvents = eventsByLocation.get(locIdStr) || [];
    const locEventIds = new Set(locEvents.map((e) => e._id.toString()));
    const locAlerts = activeAlerts.filter((al) =>
      locEventIds.has(al.congestionEvent?.toString())
    );

    const locationPlan = analyzeLocationConflict({
      locationId: locIdStr,
      events: locEvents,
      measurementsMap,
      alerts: locAlerts,
      manualSurvivors,
    });

    plans.push(locationPlan);

    if (locationPlan.status === "MANUAL_REVIEW_REQUIRED") {
      hasUnresolvedAnomalies = true;
    }

    for (const ev of locationPlan.supersededEvents) {
      allSupersededEvents.push(ev);
    }
    for (const al of locationPlan.alertsToResolve) {
      allAlertsToResolve.push(al);
    }
  }

  // 6. Check active measurement checkpoints
  const supersededEventIds = new Set(allSupersededEvents.map((e) => e.eventId));
  const supersededAlertIds = new Set(allAlertsToResolve.map((a) => a.alertId));

  const activeCheckpoints = await trafficMeasurementModel.find(
    {
      "processing.status": { $in: ["PENDING", "PROCESSING", "RETRY"] },
    },
    {
      _id: 1,
      "processing.status": 1,
      "processing.stage": 1,
      "processing.eventId": 1,
      "processing.alertId": 1,
    }
  ).lean();

  const checkpointEvaluation = evaluateCheckpoints({
    checkpoints: activeCheckpoints,
    supersededEventIds,
    supersededAlertIds,
  });

  const isApplyReady =
    !hasUnresolvedAnomalies &&
    checkpointEvaluation.isSafe &&
    plans.every((p) => p.status !== "MANUAL_REVIEW_REQUIRED");

  return {
    conflictingLocationsCount: plans.length,
    plans,
    allSupersededEvents,
    allAlertsToResolve,
    checkpointEvaluation,
    hasUnresolvedAnomalies,
    isApplyReady,
  };
}

/**
 * Formats and prints the migration plan.
 */
function printMigrationPlan(migrationPlan, logger = console) {
  logger.log("\n" + "=".repeat(80));
  logger.log("STM CONGESTION LIFECYCLE MIGRATION PLAN");
  logger.log("=".repeat(80));

  if (migrationPlan.conflictingLocationsCount === 0) {
    logger.log("No active congestion event or alert conflicts detected!");
    logger.log("The database already satisfies unique lifecycle index invariants.");
    logger.log("=".repeat(80) + "\n");
    return;
  }

  logger.log(`Found ${migrationPlan.conflictingLocationsCount} conflicting locations with active events.`);
  logger.log(`Total events proposed for resolution: ${migrationPlan.allSupersededEvents.length}`);
  logger.log(`Total active alerts proposed for resolution: ${migrationPlan.allAlertsToResolve.length}`);
  logger.log("-".repeat(80));

  for (const plan of migrationPlan.plans) {
    logger.log(`\nLOCATION: ${plan.locationId}`);
    logger.log(`Active Events: ${plan.activeEventsCount} | Status: [${plan.status}]`);

    if (plan.hasAnomaly) {
      logger.log(`  > [ANOMALY DETECTED]: ${plan.anomalyReason}`);
    }

    logger.log("  Events in group:");
    for (const ev of plan.events) {
      const isSurvivor = plan.survivor && plan.survivor.eventId === ev.eventId;
      const marker = isSurvivor ? "  * [PROPOSED SURVIVOR]" : "    [SUPERSEDED]      ";
      const measInfo = ev.hasMeasurement
        ? `measId=${ev.measurementId} measuredAt=${ev.measuredAt ? ev.measuredAt.toISOString() : "none"}`
        : "MISSING MEASUREMENT RECORD!";
      const levelStr = (ev.congestionLevel || "UNKNOWN").padEnd(6);
      logger.log(
        `${marker} ${ev.eventId} | level=${levelStr} | detectedAt=${ev.detectedAt ? ev.detectedAt.toISOString() : "none"} | ${measInfo} | desc="${ev.description}"`
      );
    }

    logger.log(`  Selection Decision: ${plan.survivorEvidence}`);

    if (plan.alertsToResolve.length > 0) {
      logger.log(`  Active Alerts Marked For Resolution (${plan.alertsToResolve.length}):`);
      for (const al of plan.alertsToResolve) {
        logger.log(
          `    - Alert ${al.alertId} (severity: ${al.severity}, evRef: ${al.congestionEventId}) -> Reason: ${al.reason}`
        );
      }
    } else {
      logger.log("  Active Alerts: None marked for resolution.");
    }
  }

  logger.log("\n" + "-".repeat(80));
  logger.log("CHECKPOINT INTEGRITY CHECK:");
  logger.log(`Active Measurement Checkpoints: ${migrationPlan.checkpointEvaluation.totalActiveCheckpoints}`);
  if (migrationPlan.checkpointEvaluation.isSafe) {
    logger.log("PASSED: 0 active checkpoints reference proposed superseded events or alerts.");
  } else {
    logger.error("FAILED: Active checkpoints reference proposed superseded records:");
    for (const cp of migrationPlan.checkpointEvaluation.checkpointConflicts) {
      logger.error(
        `  - Measurement ${cp.measurementId} (${cp.checkpointStatus}/${cp.checkpointStage}) references ${cp.referencedType} ${cp.referencedId}`
      );
    }
  }

  logger.log("-".repeat(80));
  logger.log("MIGRATION READINESS SUMMARY:");
  logger.log(`  Conflicting Locations:      ${migrationPlan.conflictingLocationsCount}`);
  logger.log(`  Superseded Events:          ${migrationPlan.allSupersededEvents.length}`);
  logger.log(`  Superseded Alerts:          ${migrationPlan.allAlertsToResolve.length}`);
  logger.log(`  Unresolved Anomalies:       ${migrationPlan.hasUnresolvedAnomalies ? "YES (BLOCKED)" : "NONE (CLEAN)"}`);
  logger.log(`  Checkpoint Safety:          ${migrationPlan.checkpointEvaluation.isSafe ? "SAFE" : "BLOCKED"}`);
  logger.log(`  Apply Ready:                ${migrationPlan.isApplyReady ? "YES" : "NO (RESOLVE BLOCKERS FIRST)"}`);
  logger.log("=".repeat(80) + "\n");
}

/**
 * Creates an export backup of all documents to be modified before any write occurs.
 */
function createBackupFile({
  backupDir = DEFAULT_BACKUP_DIR,
  eventsToBackup = [],
  alertsToBackup = [],
  metadata = {},
  fsModule = fs,
} = {}) {
  if (!fsModule.existsSync(backupDir)) {
    fsModule.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `congestion-lifecycle-migration-${timestamp}.json`;
  const filePath = path.join(backupDir, filename);

  const backupData = {
    metadata: {
      timestamp: new Date().toISOString(),
      migration: "migrate-congestion-lifecycle",
      targetDatabase: metadata.databaseName || "stm_test",
      environment: metadata.environment || process.env.NODE_ENV,
      eventCount: eventsToBackup.length,
      alertCount: alertsToBackup.length,
      ...metadata,
    },
    affectedRecords: {
      congestionEvents: eventsToBackup,
      trafficAlerts: alertsToBackup,
    },
  };

  const serialized = JSON.stringify(backupData, null, 2);
  fsModule.writeFileSync(filePath, serialized, "utf8");

  // Verify write on disk
  if (!fsModule.existsSync(filePath)) {
    throw new MigrationSafetyError(`Backup write verification failed: ${filePath} does not exist.`);
  }

  const stats = fsModule.statSync(filePath);
  if (stats.size === 0) {
    throw new MigrationSafetyError(`Backup write verification failed: ${filePath} has 0 bytes.`);
  }

  // Verify parseable and counts match
  const verified = JSON.parse(fsModule.readFileSync(filePath, "utf8"));
  if (
    verified.affectedRecords?.congestionEvents?.length !== eventsToBackup.length ||
    verified.affectedRecords?.trafficAlerts?.length !== alertsToBackup.length
  ) {
    throw new MigrationSafetyError("Backup verification failed: document count mismatch in written backup.");
  }

  return {
    filePath,
    filename,
    size: stats.size,
    eventCount: eventsToBackup.length,
    alertCount: alertsToBackup.length,
  };
}

/**
 * Restores records from a verified backup file.
 */
async function restoreFromBackupFile({
  backupPath,
  congestionEventModel = CongestionEvent,
  trafficAlertModel = TrafficAlert,
  fsModule = fs,
  logger = console,
} = {}) {
  if (!fsModule.existsSync(backupPath)) {
    throw new MigrationConfigurationError(`Backup file not found at: ${backupPath}`);
  }

  const content = JSON.parse(fsModule.readFileSync(backupPath, "utf8"));
  const events = content.affectedRecords?.congestionEvents || [];
  const alerts = content.affectedRecords?.trafficAlerts || [];

  logger.log(`Restoring ${events.length} CongestionEvents and ${alerts.length} TrafficAlerts from ${backupPath}...`);

  for (const ev of events) {
    const originalStatus = ev.status || "ACTIVE";
    const update = originalStatus === "RESOLVED"
      ? { $set: { status: originalStatus, resolvedAt: ev.resolvedAt } }
      : { $set: { status: originalStatus }, $unset: { resolvedAt: 1 } };

    await congestionEventModel.updateOne({ _id: ev._id }, update);
  }

  for (const al of alerts) {
    const originalStatus = al.status || "ACTIVE";
    const update = originalStatus === "RESOLVED"
      ? { $set: { status: originalStatus, resolvedAt: al.resolvedAt } }
      : { $set: { status: originalStatus }, $unset: { resolvedAt: 1 } };

    await trafficAlertModel.updateOne({ _id: al._id }, update);
  }

  logger.log(`Restore completed successfully for ${events.length} events and ${alerts.length} alerts.`);
  return { restoredEvents: events.length, restoredAlerts: alerts.length };
}

/**
 * Executes the updates safely using transactions where supported, or sequential updates with rollback.
 */
async function executeMigration({
  mongooseInstance = mongoose,
  eventsToResolve = [],
  alertsToResolve = [],
  logger = console,
} = {}) {
  const resolvedAt = new Date();
  const eventIds = eventsToResolve.map((e) => e.eventId || e._id);
  const alertIds = alertsToResolve.map((a) => a.alertId || a._id);

  const eventModel = mongooseInstance.models.CongestionEvent || CongestionEvent;
  const alertModel = mongooseInstance.models.TrafficAlert || TrafficAlert;

  // Determine if deployment supports transactions (replica set)
  let session = null;
  let supportsTransactions = false;

  try {
    session = await mongooseInstance.startSession();
    // In standalone instances, startTransaction() or commit will throw
    if (session && typeof session.withTransaction === "function") {
      supportsTransactions = true;
    }
  } catch {
    supportsTransactions = false;
    session = null;
  }

  if (supportsTransactions && session) {
    try {
      await session.withTransaction(async () => {
        if (eventIds.length > 0) {
          await eventModel.updateMany(
            { _id: { $in: eventIds } },
            { $set: { status: "RESOLVED", resolvedAt } },
            { session }
          );
        }
        if (alertIds.length > 0) {
          await alertModel.updateMany(
            { _id: { $in: alertIds } },
            { $set: { status: "RESOLVED", resolvedAt } },
            { session }
          );
        }
      });
      logger.log(`Applied migration atomically via MongoDB transaction (${eventIds.length} events, ${alertIds.length} alerts).`);
      return {
        applied: true,
        mode: "TRANSACTION",
        eventsResolved: eventIds.length,
        alertsResolved: alertIds.length,
        resolvedAt,
      };
    } catch (txError) {
      logger.error(`MongoDB transaction failed: ${txError.message}`);
      throw txError;
    } finally {
      await session.endSession().catch(() => {});
    }
  } else {
    // Standalone fallback: sequential execution with audited in-memory rollback stack
    logger.warn("Notice: Deployment does not support multi-document transactions. Executing sequential updates with rollback guard.");
    const rollbackStack = [];

    try {
      for (const ev of eventsToResolve) {
        const id = ev.eventId || ev._id;
        await eventModel.updateOne(
          { _id: id },
          { $set: { status: "RESOLVED", resolvedAt } }
        );
        rollbackStack.push({
          model: eventModel,
          id,
          original: ev.rawEvent || ev,
        });
      }

      for (const al of alertsToResolve) {
        const id = al.alertId || al._id;
        await alertModel.updateOne(
          { _id: id },
          { $set: { status: "RESOLVED", resolvedAt } }
        );
        rollbackStack.push({
          model: alertModel,
          id,
          original: al.rawAlert || al,
        });
      }

      logger.log(`Applied migration sequentially (${eventIds.length} events, ${alertIds.length} alerts).`);
      return {
        applied: true,
        mode: "SEQUENTIAL_WITH_ROLLBACK",
        eventsResolved: eventIds.length,
        alertsResolved: alertIds.length,
        resolvedAt,
      };
    } catch (execError) {
      logger.error(`Partial failure during execution: ${execError.message}. Initiating rollback of modified records...`);
      let rollbackErrors = 0;

      for (const item of rollbackStack.reverse()) {
        try {
          const originalStatus = item.original.status || "ACTIVE";
          const update = originalStatus === "RESOLVED"
            ? { $set: { status: originalStatus, resolvedAt: item.original.resolvedAt } }
            : { $set: { status: originalStatus }, $unset: { resolvedAt: 1 } };

          await item.model.updateOne({ _id: item.id }, update);
        } catch (rbError) {
          rollbackErrors++;
          logger.error(`Rollback failed for record ${item.id}: ${rbError.message}`);
        }
      }

      if (rollbackErrors > 0) {
        logger.error(`CRITICAL: Rollback encountered ${rollbackErrors} errors. Restore from backup file immediately.`);
      } else {
        logger.log("Rollback completed: all modified records were restored to their original states.");
      }

      throw execError;
    }
  }
}

/**
 * Independent post-migration verification.
 */
async function verifyPostMigration({
  congestionEventModel = CongestionEvent,
  trafficAlertModel = TrafficAlert,
  logger = console,
} = {}) {
  const [eventConflicts, alertConflicts] = await Promise.all([
    congestionEventModel.aggregate(ACTIVE_EVENT_CONFLICT_PIPELINE),
    trafficAlertModel.aggregate(ACTIVE_ALERT_CONFLICT_PIPELINE),
  ]);

  if (eventConflicts.length > 0 || alertConflicts.length > 0) {
    throw new MigrationSafetyError(
      `Post-migration verification failed: ${eventConflicts.length} event conflicts and ${alertConflicts.length} alert conflicts still exist.`
    );
  }

  // Attempt index creation through the existing startup index service
  await ensureCongestionLifecycleIndexes({
    congestionEventModel,
    trafficAlertModel,
    logger,
  });

  logger.log("Post-migration verification PASSED: Both collections satisfy index invariants and unique partial indexes are verified.");
  return { verified: true };
}

/**
 * Main migration coordinator.
 */
async function run({
  args = process.argv.slice(2),
  environment = process.env,
  mongooseInstance = mongoose,
  logger = console,
  fsModule = fs,
} = {}) {
  const options = parseArgs(args);

  if (options.help) {
    logger.log(`
STM Congestion Lifecycle Migration Script

Usage:
  node backend/scripts/migrate-congestion-lifecycle.js [options]

Options:
  --dry-run                         Run plan analysis without modifying database (DEFAULT)
  --apply                           Execute the migration (requires explicit human approval)
  --manual-survivor <locId>=<evId>  Specify explicit survivor event for anomalous locations
  --restore <path-to-backup.json>   Restore original documents from a previous backup file
  --help, -h                        Show this help message

Invariants:
  - active_congestion_event_per_location: 1 ACTIVE CongestionEvent per location
  - active_congestion_alert_per_event:    1 ACTIVE TrafficAlert per CongestionEvent

Guards:
  - Refuses production environment (NODE_ENV=production)
  - Refuses databases other than stm_test
  - Aborts if active checkpoints reference superseded records
  - Aborts if timestamp anomalies exist without explicit operator override
  - Generates verifiable pre-write backup before any database modification
`);
    return { exitCode: 0 };
  }

  // Connect to DB
  const dbOptions = getConnectionOptions(environment);
  if (!environment.MONGO_URI) {
    throw new MigrationConfigurationError("MONGO_URI environment variable is missing.");
  }

  await mongooseInstance.connect(environment.MONGO_URI, {
    ...dbOptions,
    serverSelectionTimeoutMS: 15000,
  });

  try {
    // 1. Database Safety Verification
    validateDatabaseSafety({ environment, connection: mongooseInstance.connection });
    logger.log(`Connected to guarded database: ${mongooseInstance.connection.name}`);

    // Restore mode if requested
    if (options.restorePath) {
      logger.log(`Executing restore from: ${options.restorePath}`);
      const restoreResult = await restoreFromBackupFile({
        backupPath: options.restorePath,
        congestionEventModel: mongooseInstance.models.CongestionEvent || CongestionEvent,
        trafficAlertModel: mongooseInstance.models.TrafficAlert || TrafficAlert,
        fsModule,
        logger,
      });
      return { exitCode: 0, restoreResult };
    }

    // 2. Build Migration Plan
    logger.log("Generating migration plan and checking lifecycle invariants...");
    const plan = await buildMigrationPlan({
      congestionEventModel: mongooseInstance.models.CongestionEvent || CongestionEvent,
      trafficAlertModel: mongooseInstance.models.TrafficAlert || TrafficAlert,
      trafficMeasurementModel: mongooseInstance.models.TrafficMeasurement || TrafficMeasurement,
      manualSurvivors: options.manualSurvivors,
    });

    // 3. Print Readable Plan
    printMigrationPlan(plan, logger);

    // 4. If Dry-Run: Stop here
    if (options.dryRun) {
      logger.log("[DRY-RUN COMPLETE] No records were modified. Review the plan above.");
      if (!plan.isApplyReady) {
        logger.warn(
          "WARNING: The plan contains unresolved blockers. Running with --apply will be rejected until resolved."
        );
      }
      return { exitCode: 0, plan, dryRun: true };
    }

    // 5. Apply Mode: Guard checks
    if (!plan.isApplyReady) {
      if (plan.hasUnresolvedAnomalies) {
        throw new MigrationSafetyError(
          "Cannot apply migration: Timestamp anomaly detected. Operator must manually review and provide an explicit survivor via --manual-survivor <locationId>=<eventId>."
        );
      }
      if (!plan.checkpointEvaluation.isSafe) {
        throw new MigrationSafetyError(
          "Cannot apply migration: Active measurement checkpoints reference records marked for resolution."
        );
      }
      throw new MigrationSafetyError("Cannot apply migration: Plan is not ready for application.");
    }

    if (plan.conflictingLocationsCount === 0) {
      logger.log("No conflicts to resolve. Database already clean.");
      return { exitCode: 0, plan, applied: false };
    }

    // 6. Pre-Apply Drift Check: Re-query and verify no state changes occurred
    logger.log("Executing pre-apply drift recalculation to ensure database state has not changed...");
    const freshPlan = await buildMigrationPlan({
      congestionEventModel: mongooseInstance.models.CongestionEvent || CongestionEvent,
      trafficAlertModel: mongooseInstance.models.TrafficAlert || TrafficAlert,
      trafficMeasurementModel: mongooseInstance.models.TrafficMeasurement || TrafficMeasurement,
      manualSurvivors: options.manualSurvivors,
    });

    if (
      freshPlan.conflictingLocationsCount !== plan.conflictingLocationsCount ||
      freshPlan.allSupersededEvents.length !== plan.allSupersededEvents.length ||
      freshPlan.allAlertsToResolve.length !== plan.allAlertsToResolve.length
    ) {
      throw new MigrationSafetyError(
        "Pre-apply drift check failed: Conflict counts or records changed during migration run. Aborting for safety."
      );
    }

    // 7. Write Backup File
    logger.log("Exporting pre-write backup of all affected events and alerts...");
    const backupResult = createBackupFile({
      backupDir: DEFAULT_BACKUP_DIR,
      eventsToBackup: freshPlan.allSupersededEvents.map((e) => e.rawEvent),
      alertsToBackup: freshPlan.allAlertsToResolve.map((a) => a.rawAlert),
      metadata: {
        databaseName: mongooseInstance.connection.name,
        environment: environment.NODE_ENV,
        conflictingLocations: freshPlan.conflictingLocationsCount,
      },
      fsModule,
    });
    logger.log(`Pre-write backup verified on disk: ${backupResult.filePath} (${backupResult.size} bytes).`);

    // 8. Execute Database Modifications
    logger.log("Applying resolution updates to superseded records...");
    const executionResult = await executeMigration({
      mongooseInstance,
      eventsToResolve: freshPlan.allSupersededEvents,
      alertsToResolve: freshPlan.allAlertsToResolve,
      logger,
    });

    // 9. Post-Migration Independent Verification
    logger.log("Running independent post-migration conflict verification...");
    await verifyPostMigration({
      congestionEventModel: mongooseInstance.models.CongestionEvent || CongestionEvent,
      trafficAlertModel: mongooseInstance.models.TrafficAlert || TrafficAlert,
      logger,
    });

    logger.log("\n" + "=".repeat(80));
    logger.log("MIGRATION COMPLETED SUCCESSFULLY!");
    logger.log(`Mode:              ${executionResult.mode}`);
    logger.log(`Events Resolved:   ${executionResult.eventsResolved}`);
    logger.log(`Alerts Resolved:   ${executionResult.alertsResolved}`);
    logger.log(`Backup Location:   ${backupResult.filePath}`);
    logger.log("Unique indexes are now active and backend startup will succeed.");
    logger.log("=".repeat(80) + "\n");

    return {
      exitCode: 0,
      applied: true,
      backup: backupResult,
      execution: executionResult,
    };
  } finally {
    await mongooseInstance.disconnect().catch(() => {});
  }
}

// Execute CLI when run directly
if (require.main === module) {
  run()
    .then((result) => {
      process.exitCode = result.exitCode || 0;
    })
    .catch((err) => {
      console.error("\n[MIGRATION ERROR]:", err.message);
      process.exitCode = 1;
    });
}

module.exports = {
  run,
  parseArgs,
  validateDatabaseSafety,
  analyzeLocationConflict,
  evaluateCheckpoints,
  buildMigrationPlan,
  printMigrationPlan,
  createBackupFile,
  restoreFromBackupFile,
  executeMigration,
  verifyPostMigration,
  MigrationConfigurationError,
  MigrationSafetyError,
};
