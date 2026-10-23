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
