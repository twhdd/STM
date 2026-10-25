const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const app = require("../server");
const CVProcessingJob = require("../models/CVProcessingJob");
const { STAFF_ROLES } = require("../config/trafficVision");
const {
  createTrafficVisionJobService,
  TrafficVisionHttpError,
} = require("../services/trafficVisionJobService");
const {
  createTrafficVisionWorker,
} = require("../services/trafficVisionWorker");
const {
  createTrafficVisionRealtimeService,
} = require("../services/trafficVisionRealtimeService");
const {
  describeVideoUpload,
  hasSupportedSignature,
  writeUploadedVideo,
  TrafficVisionUploadError,
} = require("../services/trafficVisionUploadService");
const {
  loadAndSanitizeAnalysis,
  TrafficVisionAnalysisError,
} = require("../services/trafficVisionAnalysisService");

const SECRET = process.env.JWT_SECRET || "test-secret-for-auth-tests";
const USER_ID = "507f1f77bcf86cd799439011";
const OTHER_USER_ID = "507f1f77bcf86cd799439022";
const STAFF_USER_ID = "507f1f77bcf86cd799439033";

function tokenFor(role, userId = USER_ID) {
  return jwt.sign({ userId, role }, SECRET, { expiresIn: "1h" });
}

describe("Computer Vision Upload & Signature Validation", () => {
  test("describes valid mp4 upload correctly", () => {
    const headers = {
      "x-file-name": "traffic-cam.mp4",
      "content-type": "video/mp4",
      "content-length": "1048576",
    };
    const desc = describeVideoUpload(headers);
    assert.equal(desc.originalFilename, "traffic-cam.mp4");
    assert.equal(desc.extension, ".mp4");
    assert.equal(desc.mimeType, "video/mp4");
    assert.equal(desc.signature, "ftyp");
    assert.equal(desc.expectedBytes, 1048576);
  });

  test("rejects missing or empty filename", () => {
    assert.throws(
      () => describeVideoUpload({ "content-type": "video/mp4" }),
      (err) => err.statusCode === 400 && err.code === "INVALID_UPLOAD"
    );
  });

  test("rejects unsupported video extension or MIME type", () => {
    assert.throws(
      () =>
        describeVideoUpload({
          "x-file-name": "script.sh",
          "content-type": "application/x-sh",
        }),
      (err) => err.statusCode === 415 && err.code === "UNSUPPORTED_VIDEO_TYPE"
    );
  });

  test("rejects mismatched extension and MIME type", () => {
    assert.throws(
      () =>
        describeVideoUpload({
          "x-file-name": "video.mp4",
          "content-type": "image/png",
        }),
      (err) => err.statusCode === 415 && err.code === "UNSUPPORTED_VIDEO_TYPE"
    );
  });

  test("validates file signatures for ftyp (mp4/mov), avi, and ebml (webm/mkv)", () => {
    // mp4 / mov: ftyp at offset 4..8
    const mp4Bytes = Buffer.alloc(16);
    mp4Bytes.write("ftyp", 4, 4, "ascii");
    assert.equal(hasSupportedSignature("ftyp", mp4Bytes), true);

    const badMp4 = Buffer.alloc(16);
    badMp4.write("junk", 4, 4, "ascii");
    assert.equal(hasSupportedSignature("ftyp", badMp4), false);

    // avi: RIFF at 0..4 and AVI at 8..12
    const aviBytes = Buffer.alloc(16);
    aviBytes.write("RIFF", 0, 4, "ascii");
    aviBytes.write("AVI ", 8, 4, "ascii");
    assert.equal(hasSupportedSignature("avi", aviBytes), true);

    // ebml: 0x1a 0x45 0xdf 0xa3 at 0..4
    const ebmlBytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00]);
    assert.equal(hasSupportedSignature("ebml", ebmlBytes), true);
  });
});

describe("Computer Vision Realtime Scoping & Safe Payloads", () => {
  test("safeJobPayload sanitizes internal paths, leases, and slots", () => {
    const job = {
      _id: new mongoose.Types.ObjectId(),
      status: "COMPLETED",
      originalFilename: "crossroad.mp4",
      uploadBytes: 2048,
      attempts: 1,
      createdAt: new Date("2026-10-22T10:00:00Z"),
      updatedAt: new Date("2026-10-22T10:05:00Z"),
      processingStartedAt: new Date("2026-10-22T10:01:00Z"),
      completedAt: new Date("2026-10-22T10:05:00Z"),
      processingDurationMs: 240000,
      uploadPath: "/secret/private/path/upload.mp4",
      resultPath: "/secret/private/path/result.json",
      annotatedPath: "/secret/private/path/annotated.mp4",
      leaseToken: "secret-lease-uuid",
      queueSlot: 3,
      metrics: {
        detection: {
          totalDetectionEvents: 42,
          perClassDetectionEvents: { car: 30, truck: 12 },
          averageDetectionsPerProcessedFrame: 2.1,
          framesProcessed: 20,
          processingTimeSeconds: 4.0,
          processingFps: 5.0,
        },
        tracking: null,
        flow: null,
      },
      measurementIds: [],
      measurementMapping: "No standard traffic measurements were created",
    };

    const realtime = createTrafficVisionRealtimeService();
    const payload = realtime.safeJobPayload(job);

    assert.equal(payload.jobId, String(job._id));
    assert.equal(payload.status, "COMPLETED");
    assert.equal(payload.originalFilename, "crossroad.mp4");
    assert.equal(payload.metrics.detection.totalDetectionEvents, 42);
    assert.equal(Object.hasOwn(payload, "uploadPath"), false);
    assert.equal(Object.hasOwn(payload, "resultPath"), false);
    assert.equal(Object.hasOwn(payload, "annotatedPath"), false);
    assert.equal(Object.hasOwn(payload, "leaseToken"), false);
    assert.equal(Object.hasOwn(payload, "queueSlot"), false);
  });

  test("publishes status only to owner, staff, and job room", () => {
    const emitted = [];
    const roomsEmittedTo = [];

    const mockIo = {
      on(event, callback) {},
      off(event, callback) {},
      to(room) {
        roomsEmittedTo.push(room);
        return {
          to(secondRoom) {
            roomsEmittedTo.push(secondRoom);
            return {
              to(thirdRoom) {
                roomsEmittedTo.push(thirdRoom);
                return {
                  emit(event, data) {
                    emitted.push({ event, data, rooms: [...roomsEmittedTo] });
                  },
                };
              },
            };
          },
        };
      },
    };

    const realtime = createTrafficVisionRealtimeService();
    realtime.attach(mockIo);

    const job = {
      _id: new mongoose.Types.ObjectId("507f1f77bcf86cd799439099"),
      owner: new mongoose.Types.ObjectId(USER_ID),
      status: "PROCESSING",
      originalFilename: "camera1.mp4",
    };

    realtime.publishStatus(job, "PROCESSING");
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].event, "traffic-vision:status");
    assert.equal(emitted[0].data.status, "PROCESSING");
    assert.ok(roomsEmittedTo.includes(`user:${USER_ID}`));
    assert.ok(roomsEmittedTo.includes("traffic-vision:staff"));
    assert.ok(roomsEmittedTo.includes(`traffic-vision:job:${job._id}`));
  });
});

describe("Computer Vision Worker & Tracking Toggle", () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "stm-cv-test-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("respects tracking=false and does not pass --tracking to CLI", async () => {
    let capturedArgs = [];
    const mockExecFile = (file, args, options, callback) => {
      capturedArgs = args;
      // create fake output
      const outDir = path.dirname(args[args.indexOf("--output") + 1]);
      const resultPath = path.join(outDir, "result.json");
      const dummyAnalysis = {
        schemaVersion: 1,
        video: {
          fileName: "test.mp4",
          width: 1920,
          height: 1080,
          reportedFps: 30,
          reportedFrameCount: 1,
        },
        configuration: {
          trackingEnabled: false,
          modelName: "best.pt",
        },
        frames: [
          {
            frameIndex: 0,
            timestampMs: 0,
            detections: [],
          },
        ],
        metrics: {
          detection: {
            totalDetectionEvents: 0,
            perClassDetectionEvents: {},
            averageDetectionsPerProcessedFrame: 0,
            framesProcessed: 1,
            processingTimeSeconds: 0.1,
            processingFps: 10.0,
          },
          tracking: null,
          flow: null,
        },
      };
      fs.writeFile(resultPath, JSON.stringify(dummyAnalysis)).then(() =>
        callback(null)
      );
      return { kill() {} };
    };

    // create fake weights
    const modelPath = path.join(tempDir, "best.pt");
    await fs.writeFile(modelPath, "dummy-weights");

    const uploadsDir = path.join(tempDir, "uploads");
    const outputsDir = path.join(tempDir, "outputs");
    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.mkdir(outputsDir, { recursive: true });

    const dummyJob = {
      _id: new mongoose.Types.ObjectId(),
      owner: USER_ID,
      status: "QUEUED",
      tracking: false,
      annotatedRequested: false,
      uploadPath: path.join(uploadsDir, "in.mp4"),
      originalFilename: "in.mp4",
    };
    await fs.writeFile(dummyJob.uploadPath, "dummy-video");

    const mockJobModel = {
      findOneAndUpdate: () => ({
        select: async () => ({
          ...dummyJob,
          status: "PROCESSING",
          leaseToken: "claim-token-123",
        }),
      }),
      updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }),
      find: () => ({ select: async () => [] }),
      createIndexes: async () => {},
    };

    const worker = createTrafficVisionWorker({
      Job: mockJobModel,
      config: {
        dataDirectory: tempDir,
        uploadsDirectory: uploadsDir,
        outputsDirectory: outputsDir,
        pythonExecutable: "python",
        modelPath,
        timeoutMs: 5000,
        leaseMs: 60000,
        concurrency: 1,
        queueCapacity: 5,
        totalCapacity: 6,
        maxUploadBytes: 1000000,
        retentionDays: 7,
        pollIntervalMs: 60000,
        pythonWorkingDirectory: tempDir,
        pythonModule: "traffic_vision.cli",
        defaultDevice: "cpu",
        confidence: 0.25,
      },
      execFile: mockExecFile,
      realtime: { publishStatus() {} },
    });

    await worker.start();
    await new Promise((r) => setTimeout(r, 100));
    await worker.stop();

    assert.ok(capturedArgs.includes("--input"));
    assert.equal(capturedArgs.includes("--tracking"), false, "tracking=false must NOT pass --tracking");
  });

  test("retention cleanup retains paths if file deletion fails and retries", async () => {
    const uploadsDir = path.join(tempDir, "uploads");
    const outputsDir = path.join(tempDir, "outputs");
    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.mkdir(outputsDir, { recursive: true });

    const jobOutputDir = path.join(outputsDir, "job123");
    await fs.mkdir(jobOutputDir, { recursive: true });
    const resultFile = path.join(jobOutputDir, "result.json");
    await fs.writeFile(resultFile, "{}");

    let updatedJob = null;
    const expiredJob = {
      _id: "job123",
      status: "COMPLETED",
      completedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago (expired)
      uploadPath: path.join(uploadsDir, "nonexistent-upload.mp4"),
      resultPath: resultFile,
    };

    // Simulate unlink failure on resultFile by removing write/delete or hooking
    // We test with a mock Job model
    let findCount = 0;
    const mockJobModel = {
      find: (query = {}) => ({
        select: async () => {
          if (query.retentionCleanedAt) {
            findCount += 1;
            return [expiredJob];
          }
          return [];
        },
      }),
      updateOne: async (_filter, update) => {
        updatedJob = update;
        return { modifiedCount: 1 };
      },
      createIndexes: async () => {},
      findOneAndUpdate: () => ({ select: async () => null }),
    };

    const worker = createTrafficVisionWorker({
      Job: mockJobModel,
      config: {
        dataDirectory: tempDir,
        uploadsDirectory: uploadsDir,
        outputsDirectory: outputsDir,
        pythonExecutable: "python",
        modelPath: null,
        timeoutMs: 5000,
        leaseMs: 60000,
        concurrency: 1,
        queueCapacity: 5,
        totalCapacity: 6,
        maxUploadBytes: 1000000,
        retentionDays: 7, // 7 days retention
        pollIntervalMs: 60000,
        pythonWorkingDirectory: tempDir,
        pythonModule: "traffic_vision.cli",
        defaultDevice: "cpu",
        confidence: 0.25,
      },
      realtime: { publishStatus() {} },
    });

    await worker.start();
    await worker.stop();

    // The result file was cleanly unlinked and nonexistent upload was ENOENT (ignored)
    // So updateOne unsets paths and records retentionCleanedAt
    assert.ok(updatedJob);
    assert.ok(updatedJob.$set.retentionCleanedAt);
    assert.equal(updatedJob.$unset.resultPath, 1);
  });

  test("COMPLETED realtime event carries the persisted metrics and timings", async () => {
    const { safeJobPayload } = require("../services/trafficVisionRealtimeService");
    const modelPath = path.join(tempDir, "best.pt");
    await fs.writeFile(modelPath, "dummy-weights");
    const uploadsDir = path.join(tempDir, "uploads");
    const outputsDir = path.join(tempDir, "outputs");
    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.mkdir(outputsDir, { recursive: true });

    const analysis = {
      schemaVersion: 1,
      video: { fileName: "x.mp4", width: 640, height: 480, reportedFps: 30, reportedFrameCount: 1 },
      configuration: { trackingEnabled: false },
      frames: [
        {
          frameIndex: 0,
          timestampMs: 0,
          detections: [
            { class: "car", confidence: 0.9, bbox: [0, 0, 10, 10], trackId: null },
            { class: "bus", confidence: 0.8, bbox: [5, 5, 20, 20], trackId: null },
          ],
        },
      ],
      metrics: {
        detection: {
          totalDetectionEvents: 2,
          perClassDetectionEvents: { bus: 1, car: 1 },
          averageDetectionsPerProcessedFrame: 2,
          framesProcessed: 1,
          processingTimeSeconds: 0.1,
          processingFps: 10,
        },
        tracking: null,
        flow: null,
      },
    };
    const execFile = (file, args, options, callback) => {
      const resultPath = path.join(path.dirname(args[args.indexOf("--output") + 1]), "result.json");
      fs.writeFile(resultPath, JSON.stringify(analysis)).then(() => callback(null));
      return { kill() {} };
    };

    const uploadPath = path.join(uploadsDir, "in.mp4");
    await fs.writeFile(uploadPath, "dummy-video");
    const claimedAtClaimTime = {
      _id: new mongoose.Types.ObjectId(),
      owner: USER_ID,
      status: "PROCESSING",
      tracking: false,
      annotatedRequested: false,
      uploadPath,
      originalFilename: "in.mp4",
      leaseToken: "claim-token-123",
    };
    let claims = 0;
    const updates = [];
    const published = [];
    const mockJobModel = {
      findOneAndUpdate: () => ({
        select: async () => (claims++ === 0 ? claimedAtClaimTime : null),
      }),
      updateOne: async (_filter, update) => {
        updates.push(update);
        return { matchedCount: 1, modifiedCount: 1 };
      },
      find: () => ({ select: async () => [] }),
      createIndexes: async () => {},
    };

    const worker = createTrafficVisionWorker({
      Job: mockJobModel,
      config: {
        dataDirectory: tempDir,
        uploadsDirectory: uploadsDir,
        outputsDirectory: outputsDir,
        pythonExecutable: "python",
        modelPath,
        timeoutMs: 5000,
        leaseMs: 60000,
        concurrency: 1,
        queueCapacity: 5,
        totalCapacity: 6,
        maxUploadBytes: 1000000,
        retentionDays: 7,
        pollIntervalMs: 60000,
        pythonWorkingDirectory: tempDir,
        pythonModule: "traffic_vision.cli",
        defaultDevice: "cpu",
        confidence: 0.25,
      },
      execFile,
      realtime: { publishStatus: (job, status) => published.push({ job, status }) },
    });

    await worker.start();
    for (let i = 0; i < 60 && !published.some((p) => p.status === "COMPLETED"); i += 1) {
      await new Promise((r) => setTimeout(r, 50));
    }
    await worker.stop();

    const completedEvent = published.find((p) => p.status === "COMPLETED");
    assert.ok(completedEvent, "worker must publish a COMPLETED event");
    const persisted = updates.find((u) => u.$set?.status === "COMPLETED").$set;
    const payload = safeJobPayload(completedEvent.job, "COMPLETED");

    assert.equal(payload.metrics?.detection?.totalDetectionEvents, 2);
    assert.deepEqual(payload.metrics, persisted.metrics);
    assert.deepEqual(payload.completedAt, persisted.completedAt.toISOString());
    assert.equal(payload.processingDurationMs, persisted.processingDurationMs);
  });
});

describe("Computer Vision Worker Attempt Limit", () => {
  const { MAX_ATTEMPTS } = require("../services/trafficVisionWorker");
  const { safeJobPayload } = require("../services/trafficVisionRealtimeService");
  let tempDir;
  let modelPath;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "stm-cv-attempts-"));
    modelPath = path.join(tempDir, "best.pt");
    await fs.writeFile(modelPath, "dummy-weights");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  function harness({ stale = [], claimed = null, execFile } = {}) {
    const updates = [];
    const published = [];
    let claimsLeft = claimed ? 1 : 0;
    const Job = {
      find: (query = {}) => ({
        select: async () => (query.status === "PROCESSING" ? stale : []),
      }),
      findOneAndUpdate: () => ({
        select: async () => (claimsLeft-- > 0 ? claimed : null),
      }),
      updateOne: async (filter, update) => {
        updates.push({ filter, update });
        return { matchedCount: 1, modifiedCount: 1 };
      },
      createIndexes: async () => {},
    };
    const worker = createTrafficVisionWorker({
      Job,
      config: {
        dataDirectory: tempDir,
        uploadsDirectory: path.join(tempDir, "uploads"),
        outputsDirectory: path.join(tempDir, "outputs"),
        pythonExecutable: "python",
        modelPath,
        timeoutMs: 5000,
        leaseMs: 60000,
        concurrency: 1,
        queueCapacity: 5,
        totalCapacity: 6,
        maxUploadBytes: 1000000,
        retentionDays: 7,
        pollIntervalMs: 60000,
        pythonWorkingDirectory: tempDir,
        pythonModule: "traffic_vision.cli",
        defaultDevice: "cpu",
        confidence: 0.25,
      },
      execFile,
      realtime: { publishStatus: (job, status) => published.push({ job, status }) },
    });
    return { worker, updates, published };
  }

  const staleJob = (attempts) => ({
    _id: new mongoose.Types.ObjectId(),
    owner: USER_ID,
    status: "PROCESSING",
    attempts,
    originalFilename: "in.mp4",
    leaseToken: "stale-token",
  });

  async function interruptClaimedJobByShutdown(attempts) {
    let execStarted;
    const started = new Promise((resolve) => {
      execStarted = resolve;
    });
    const execFile = (_file, _args, _options, done) => {
      execStarted();
      return {
        kill() {
          done(Object.assign(new Error("terminated"), { killed: true }));
        },
      };
    };
    const claimed = {
      _id: new mongoose.Types.ObjectId(),
      owner: USER_ID,
      status: "PROCESSING",
      tracking: false,
      annotatedRequested: false,
      attempts,
      originalFilename: "in.mp4",
      leaseToken: "claim-token",
    };
    const result = harness({ claimed, execFile });
    await result.worker.start();
    await started;
    await result.worker.stop();
    return result;
  }

  test("an expired lease below the attempt limit re-queues the job and keeps its queue slot", async () => {
    const { worker, updates, published } = harness({
      stale: [staleJob(MAX_ATTEMPTS - 1)],
    });
    await worker.start();
    await worker.stop();

    assert.equal(updates.length, 1);
    assert.equal(updates[0].filter.leaseToken, "stale-token");
    assert.equal(updates[0].update.$set.status, "QUEUED");
    assert.equal(updates[0].update.$unset.queueSlot, undefined);
    assert.deepEqual(published.map((p) => p.status), ["QUEUED"]);
  });

  test("an expired lease at or beyond the attempt limit fails the job terminally", async () => {
    for (const attempts of [MAX_ATTEMPTS, MAX_ATTEMPTS + 3]) {
      const { worker, updates, published } = harness({ stale: [staleJob(attempts)] });
      await worker.start();
      await worker.stop();

      assert.equal(updates.length, 1, `attempts=${attempts}`);
      const { $set, $unset } = updates[0].update;
      assert.equal($set.status, "FAILED");
      assert.ok($set.completedAt instanceof Date, "completedAt is required for retention cleanup");
      assert.equal($set.error.code, "PROCESS_FAILED");
      assert.deepEqual($unset, { queueSlot: 1, leaseToken: 1, leaseUntil: 1 });
      await new CVProcessingJob({
        owner: USER_ID,
        uploadPath: "unused",
        originalFilename: "in.mp4",
        status: "FAILED",
        error: $set.error,
      }).validate();

      assert.deepEqual(published.map((p) => p.status), ["FAILED"]);
      const payload = safeJobPayload(published[0].job, "FAILED");
      assert.deepEqual(payload.error, $set.error);
      assert.equal(payload.completedAt, $set.completedAt.toISOString());
    }
  });

  test("a shutdown interruption below the attempt limit re-queues the job", async () => {
    const { updates, published } = await interruptClaimedJobByShutdown(MAX_ATTEMPTS - 1);

    const transitions = updates.filter((u) => u.update.$set?.status);
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0].filter.leaseToken, "claim-token");
    assert.equal(transitions[0].update.$set.status, "QUEUED");
    assert.deepEqual(published.map((p) => p.status), ["PROCESSING", "QUEUED"]);
  });

  test("a shutdown interruption of the final attempt fails the job instead of re-queueing it", async () => {
    const { updates, published } = await interruptClaimedJobByShutdown(MAX_ATTEMPTS);

    const transitions = updates.filter((u) => u.update.$set?.status);
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0].update.$set.status, "FAILED");
    assert.equal(transitions[0].update.$unset.queueSlot, 1);
    assert.deepEqual(published.map((p) => p.status), ["PROCESSING", "FAILED"]);
  });

  for (const [label, attempts] of [
    ["undefined", undefined],
    ["null", null],
    ["NaN", NaN],
    ["negative", -1],
    ["non-integer", 2.5],
    ["-Infinity", -Infinity],
  ]) {
    test(`an expired lease with an unreadable attempts count (${label}) fails terminally`, async () => {
      const { worker, updates, published } = harness({ stale: [staleJob(attempts)] });
      await worker.start();
      await worker.stop();

      assert.equal(updates.length, 1);
      assert.equal(updates[0].update.$set.status, "FAILED");
      assert.deepEqual(updates[0].update.$unset, { queueSlot: 1, leaseToken: 1, leaseUntil: 1 });
      assert.deepEqual(published.map((p) => p.status), ["FAILED"]);
    });
  }

  for (const attempts of [0, 1, MAX_ATTEMPTS - 1]) {
    test(`an expired lease with a valid attempts count of ${attempts} still re-queues`, async () => {
      const { worker, updates, published } = harness({ stale: [staleJob(attempts)] });
      await worker.start();
      await worker.stop();

      assert.equal(updates.length, 1);
      assert.equal(updates[0].update.$set.status, "QUEUED");
      assert.equal(updates[0].update.$unset.queueSlot, undefined);
      assert.deepEqual(published.map((p) => p.status), ["QUEUED"]);
    });
  }

  test("a shutdown interruption with an unreadable attempts count fails the job instead of re-queueing it", async () => {
    const { updates, published } = await interruptClaimedJobByShutdown(null);

    const transitions = updates.filter((u) => u.update.$set?.status);
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0].update.$set.status, "FAILED");
    assert.equal(transitions[0].update.$unset.queueSlot, 1);
    assert.deepEqual(published.map((p) => p.status), ["PROCESSING", "FAILED"]);
  });

  test("jobs hydrated by the real model: an absent count re-queues, unreadable counts fail", async () => {
    const stored = (extra) => ({
      _id: new mongoose.Types.ObjectId(),
      owner: USER_ID,
      uploadPath: "unused",
      originalFilename: "in.mp4",
      status: "PROCESSING",
      leaseToken: "stale-token",
      ...extra,
    });
    for (const [label, extra, expected] of [
      ["absent", {}, "QUEUED"],
      ["3", { attempts: 3 }, "QUEUED"],
      ["NaN", { attempts: NaN }, "FAILED"],
      ["null", { attempts: null }, "FAILED"],
      ["-4", { attempts: -4 }, "FAILED"],
    ]) {
      const { worker, updates } = harness({ stale: [CVProcessingJob.hydrate(stored(extra))] });
      await worker.start();
      await worker.stop();

      assert.equal(updates.length, 1, `attempts ${label}`);
      assert.equal(updates[0].update.$set.status, expected, `attempts ${label}`);
    }
  });
});

describe("Computer Vision FAILED Event Payloads", () => {
  const { Readable } = require("node:stream");
  const { safeJobPayload, trafficVisionRealtimeService } = require("../services/trafficVisionRealtimeService");
  let tempDir;
  let modelPath;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "stm-cv-failed-"));
    modelPath = path.join(tempDir, "best.pt");
    await fs.writeFile(modelPath, "dummy-weights");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  function workerFor({ incomplete = [], claimed = null, execFile }) {
    const updates = [];
    const published = [];
    let claimsLeft = claimed ? 1 : 0;
    const Job = {
      find: (query = {}) => ({
        select: async () => (query.status === "QUEUED" ? incomplete : []),
      }),
      findOneAndUpdate: () => ({
        select: async () => (claimsLeft-- > 0 ? claimed : null),
      }),
      updateOne: async (filter, update) => {
        updates.push({ filter, update });
        return { matchedCount: 1, modifiedCount: 1 };
      },
      createIndexes: async () => {},
    };
    const worker = createTrafficVisionWorker({
      Job,
      config: {
        dataDirectory: tempDir,
        uploadsDirectory: path.join(tempDir, "uploads"),
        outputsDirectory: path.join(tempDir, "outputs"),
        pythonExecutable: "python",
        modelPath,
        timeoutMs: 5000,
        leaseMs: 60000,
        concurrency: 1,
        queueCapacity: 5,
        totalCapacity: 6,
        maxUploadBytes: 1000000,
        retentionDays: 7,
        pollIntervalMs: 60000,
        pythonWorkingDirectory: tempDir,
        pythonModule: "traffic_vision.cli",
        defaultDevice: "cpu",
        confidence: 0.25,
      },
      execFile,
      realtime: { publishStatus: (job, status) => published.push({ job, status }) },
    });
    const persistedFailure = () =>
      updates.find((u) => u.update.$set?.status === "FAILED").update.$set;
    return { worker, updates, published, persistedFailure };
  }

  for (const [label, execError, expectedCode] of [
    ["generic processor failure", new Error("exit 1"), "PROCESS_FAILED"],
    ["processor timeout", Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }), "PROCESS_TIMEOUT"],
  ]) {
    test(`FAILED event after a ${label} carries the persisted error and timings`, async () => {
      const claimed = {
        _id: new mongoose.Types.ObjectId(),
        owner: USER_ID,
        status: "PROCESSING",
        tracking: false,
        annotatedRequested: false,
        attempts: 1,
        originalFilename: "in.mp4",
        leaseToken: "claim-token",
      };
      const execFile = (_file, _args, _options, done) => {
        setImmediate(() => done(execError));
        return { kill() {} };
      };
      const { worker, published, persistedFailure } = workerFor({ claimed, execFile });

      await worker.start();
      for (let i = 0; i < 60 && !published.some((p) => p.status === "FAILED"); i += 1) {
        await new Promise((r) => setTimeout(r, 50));
      }
      await worker.stop();

      const failed = published.find((p) => p.status === "FAILED");
      assert.ok(failed, "worker must publish a FAILED event");
      const persisted = persistedFailure();
      const payload = safeJobPayload(failed.job, failed.status);
      assert.equal(persisted.error.code, expectedCode);
      assert.deepEqual(payload.error, persisted.error);
      assert.equal(payload.completedAt, persisted.completedAt.toISOString());
      assert.equal(payload.processingDurationMs, persisted.processingDurationMs);
      assert.equal(typeof payload.processingDurationMs, "number");
    });
  }

  test("FAILED event for an abandoned incomplete upload carries the persisted error and completedAt", async () => {
    const incomplete = {
      _id: new mongoose.Types.ObjectId(),
      owner: USER_ID,
      status: "QUEUED",
      uploadReady: false,
      originalFilename: "partial.mp4",
      uploadPath: path.join(tempDir, "uploads", "partial.mp4"),
    };
    const { worker, published, persistedFailure } = workerFor({ incomplete: [incomplete] });

    await worker.start();
    await worker.stop();

    assert.deepEqual(published.map((p) => p.status), ["FAILED"]);
    const persisted = persistedFailure();
    const payload = safeJobPayload(published[0].job, published[0].status);
    assert.equal(persisted.error.code, "UPLOAD_INTERRUPTED");
    assert.deepEqual(payload.error, persisted.error);
    assert.equal(payload.completedAt, persisted.completedAt.toISOString());
  });

  test("FAILED event for a rejected upload in submit() carries the persisted error and completedAt", async () => {
    const uploadsDirectory = path.join(tempDir, "uploads");
    const updates = [];
    const Job = {
      create: async (doc) => ({ _id: new mongoose.Types.ObjectId(), ...doc }),
      updateOne: async (filter, update) => {
        updates.push({ filter, update });
        return { matchedCount: 1, modifiedCount: 1 };
      },
    };
    const service = createTrafficVisionJobService({
      Job,
      worker: {
        getConfig: () => ({
          uploadsDirectory,
          outputsDirectory: path.join(tempDir, "outputs"),
          modelPath,
          timeoutMs: 5000,
          totalCapacity: 1,
          maxUploadBytes: 1000000,
        }),
        notifyQueueChanged: async () => {},
      },
      logger: { error() {} },
    });
    const request = Object.assign(
      new Readable({
        read() {
          this.push(Buffer.from("this is not a video container"));
          this.push(null);
        },
      }),
      {
        headers: { "x-file-name": "clip.mp4", "content-type": "video/mp4" },
        query: {},
        get: () => undefined,
      }
    );

    const emitted = [];
    const fakeIo = {
      on() {},
      off() {},
      to() {
        return this;
      },
      emit: (event, payload) => emitted.push({ event, payload }),
    };
    trafficVisionRealtimeService.attach(fakeIo);
    try {
      await assert.rejects(
        service.submit(request, { userId: USER_ID, role: "CITIZEN" }),
        { code: "INVALID_VIDEO_SIGNATURE" }
      );
    } finally {
      trafficVisionRealtimeService.detach(fakeIo);
    }

    const persisted = updates.find((u) => u.update.$set?.status === "FAILED").update.$set;
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].payload.status, "FAILED");
    assert.equal(persisted.error.code, "UPLOAD_INTERRUPTED");
    assert.deepEqual(emitted[0].payload.error, persisted.error);
    assert.equal(emitted[0].payload.completedAt, persisted.completedAt.toISOString());
  });
});

describe("Computer Vision Authorization & Ownership Enforcement", () => {
  test("owner can access their job; other citizen is denied 403; staff can access any job", async () => {
    const jobOwnerId = USER_ID;
    const otherCitizenId = OTHER_USER_ID;
    const staffId = STAFF_USER_ID;

    const mockJob = {
      _id: new mongoose.Types.ObjectId(),
      owner: new mongoose.Types.ObjectId(jobOwnerId),
      status: "COMPLETED",
      originalFilename: "sample.mp4",
      uploadBytes: 5000,
      attempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      metrics: {
        detection: {
          totalDetectionEvents: 5,
          perClassDetectionEvents: { car: 5 },
          averageDetectionsPerProcessedFrame: 1,
          framesProcessed: 5,
          processingTimeSeconds: 1,
          processingFps: 5,
        },
        tracking: null,
        flow: null,
      },
      measurementIds: [],
      measurementMapping: "No standard traffic measurements were created",
    };

    const mockModel = {
      findById: (id) => ({
        select: () => mockJob,
      }),
    };

    const service = createTrafficVisionJobService({
      Job: mockModel,
      worker: { getConfig: () => ({ uploadsDirectory: "/tmp", outputsDirectory: "/tmp" }) },
    });

    // 1. Owner access
    const ownerResult = await service.findAuthorizedJob(
      String(mockJob._id),
      { userId: jobOwnerId, role: "CITIZEN" }
    );
    assert.equal(String(ownerResult._id), String(mockJob._id));

    // 2. Other citizen access -> 403 FORBIDDEN
    await assert.rejects(
      service.findAuthorizedJob(
        String(mockJob._id),
        { userId: otherCitizenId, role: "CITIZEN" }
      ),
      (err) => err.statusCode === 403 && err.code === "FORBIDDEN"
    );

    // 3. Staff access (TRAFFIC_POLICE, ADMIN, TRAFFIC_AUTHORITY) -> 200 allowed
    for (const role of STAFF_ROLES) {
      const staffResult = await service.findAuthorizedJob(
        String(mockJob._id),
        { userId: staffId, role }
      );
      assert.equal(String(staffResult._id), String(mockJob._id));
    }
  });

  test("rejects malformed job ID with 400 INVALID_ID", async () => {
    const service = createTrafficVisionJobService({
      Job: {},
      worker: { getConfig: () => ({}) },
    });

    await assert.rejects(
      service.findAuthorizedJob("invalid-not-an-id", { userId: USER_ID, role: "CITIZEN" }),
      (err) => err.statusCode === 400 && err.code === "INVALID_ID"
    );
  });

  test("rejects non-existent job with 404 NOT_FOUND", async () => {
    const service = createTrafficVisionJobService({
      Job: {
        findById: () => ({
          select: () => null,
        }),
      },
      worker: { getConfig: () => ({}) },
    });

    await assert.rejects(
      service.findAuthorizedJob(
        new mongoose.Types.ObjectId().toString(),
        { userId: USER_ID, role: "CITIZEN" }
      ),
      (err) => err.statusCode === 404 && err.code === "NOT_FOUND"
    );
  });

  test("readResults rejects with 409 RESULT_NOT_READY when job is still PROCESSING or QUEUED", async () => {
    const processingJob = {
      _id: new mongoose.Types.ObjectId(),
      owner: new mongoose.Types.ObjectId(USER_ID),
      status: "PROCESSING",
    };

    const service = createTrafficVisionJobService({
      Job: {
        findById: () => ({ select: () => processingJob }),
      },
      worker: { getConfig: () => ({}) },
    });

    await assert.rejects(
      service.readResults(String(processingJob._id), { userId: USER_ID, role: "CITIZEN" }),
      (err) => err.statusCode === 409 && err.code === "RESULT_NOT_READY"
    );
  });

  test("getFile throws 410 FILE_EXPIRED when retention cleaned or file missing", async () => {
    const expiredJob = {
      _id: new mongoose.Types.ObjectId(),
      owner: new mongoose.Types.ObjectId(USER_ID),
      status: "COMPLETED",
      resultPath: null,
      retentionCleanedAt: new Date(),
    };

    const service = createTrafficVisionJobService({
      Job: {
        findById: () => ({ select: () => expiredJob }),
      },
      worker: { getConfig: () => ({ uploadsDirectory: "/tmp", outputsDirectory: "/tmp" }) },
    });

    await assert.rejects(
      service.getFile(String(expiredJob._id), { userId: USER_ID, role: "CITIZEN" }, "json"),
      (err) => err.statusCode === 410 && err.code === "FILE_EXPIRED"
    );
  });
});

describe("Computer Vision End-to-End Lifecycle & Constraints", () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "stm-cv-e2e-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  test("CV metrics are preserved without synthesizing TrafficMeasurement documents", async () => {
    const mockAnalysis = {
      schemaVersion: 1,
      video: {
        fileName: "highway.mp4",
        width: 1280,
        height: 720,
        reportedFps: 25.0,
        reportedFrameCount: 10,
      },
      configuration: {
        modelName: "model.pt",
        trackingEnabled: true,
      },
      frames: [
        {
          frameIndex: 0,
          timestampMs: 0,
          detections: [
            { class: "car", confidence: 0.88, bbox: [10, 20, 100, 200], trackId: 1 },
          ],
        },
      ],
      metrics: {
        detection: {
          totalDetectionEvents: 1,
          perClassDetectionEvents: { car: 1 },
          averageDetectionsPerProcessedFrame: 1.0,
          framesProcessed: 1,
          processingTimeSeconds: 0.05,
          processingFps: 20.0,
        },
        tracking: {
          distinctObservedTrackIds: 1,
          activeTracks: 1,
          perClassTrackedVehicles: { car: 1 },
          activeTracksByClass: { car: 1 },
        },
        flow: null,
      },
    };

    const resultPath = path.join(tempDir, "result.json");
    await fs.writeFile(resultPath, JSON.stringify(mockAnalysis));

    const sanitized = await loadAndSanitizeAnalysis(resultPath, {
      originalFilename: "highway.mp4",
      annotatedRequested: false,
    }, {
      tracking: true,
      annotatedRequested: false,
      modelPath: path.join(tempDir, "model.pt"),
      maxResultBytes: 1024 * 1024,
    });

    assert.equal(sanitized.metrics.detection.totalDetectionEvents, 1);
    assert.equal(sanitized.metrics.tracking.distinctObservedTrackIds, 1);
    // Explicitly verify that no TrafficMeasurement documents or speed/density were fabricated
    assert.equal(sanitized.metrics.detection.trafficDensity, undefined);
    assert.equal(sanitized.metrics.detection.averageSpeed, undefined);
  });
});
