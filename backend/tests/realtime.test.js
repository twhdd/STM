const { after, afterEach, describe, mock, test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { io: socketClient } = require("socket.io-client");

const { authenticateSocket, createSocketServer } = require("../socket/socketServer");
const TrafficMeasurement = require("../models/TrafficMeasurement");
const CongestionEvent = require("../models/CongestionEvent");
const TrafficAlert = require("../models/TrafficAlert");
const { trafficMeasurementRecoveryWorker } = require("../services/trafficMeasurementRecoveryWorker");
const congestionDetectionService = require("../services/congestionDetectionService");
const trafficAlertService = require("../services/trafficAlertService");
const {
  AUTHENTICATED_ROOM,
  REALTIME_EVENTS,
  realtimeService,
} = require("../services/realtimeService");
const { recordTrafficMeasurement } = require("../services/trafficMeasurementIngestionService");

const JWT_SECRET = "socket-unit-test-secret";
const savedJwtSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = JWT_SECRET;

afterEach(() => {
  mock.restoreAll();
});

after(() => {
  if (savedJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = savedJwtSecret;
  }
});

function createToken(role = "CITIZEN", claims = {}) {
  return jwt.sign(
    { userId: "socket-test-user", role, ...claims },
    JWT_SECRET,
    { algorithm: "HS256" }
  );
}

function authenticate(token) {
  return new Promise((resolve) => {
    const socket = {
      handshake: { auth: token ? { token } : {} },
      data: {},
    };
    authenticateSocket(socket, (error) => resolve({ error, socket }));
  });
}

function createIoRecorder(order = []) {
  const events = [];
  return {
    events,
    io: {
      to(room) {
        assert.equal(room, AUTHENTICATED_ROOM);
        return {
          emit(eventName, payload) {
            order.push(`emit:${eventName}`);
            events.push({ eventName, payload });
          },
        };
      },
    },
  };
}

describe("Socket.IO authentication and authorization", () => {
  test("accepts authenticated sessions using every existing role", async () => {
    for (const role of [
      "ADMIN",
      "TRAFFIC_AUTHORITY",
      "TRAFFIC_POLICE",
      "EMERGENCY_SERVICE",
      "CITIZEN",
    ]) {
      const { error, socket } = await authenticate(createToken(role));
      assert.equal(error, undefined);
      assert.deepEqual(socket.data.user, { userId: "socket-test-user", role });
    }
  });

  test("rejects missing, invalid, and unknown-role tokens", async () => {
    const missing = await authenticate();
    assert.equal(missing.error.message, "Authentication required");
    assert.equal(missing.error.data.code, "UNAUTHORIZED");

    const invalid = await authenticate("not-a-jwt");
    assert.equal(invalid.error.message, "Invalid or expired token");

    const unknownRole = await authenticate(
      createToken("ROOT", { role: "ROOT" })
    );
    assert.equal(unknownRole.error.message, "Invalid or expired token");
  });

  test("installs socket authentication on the HTTP server", () => {
    const httpServer = http.createServer();
    const io = createSocketServer(httpServer);
    try {
      assert.equal(io.engine.opts.cors.origin, true);
      assert.equal(io.of("/")._fns.includes(authenticateSocket), true);
    } finally {
      io.close();
    }
  });

  test("rejects an unauthorized network connection and delivers events to an authenticated client", async () => {
    const httpServer = http.createServer();
    const io = createSocketServer(httpServer);
    realtimeService.attach(io);
    let authorizedClient;
    let unauthorizedClient;

    try {
      await new Promise((resolve) =>
        httpServer.listen(0, "127.0.0.1", resolve)
      );
      const endpoint = `http://127.0.0.1:${httpServer.address().port}`;
      authorizedClient = socketClient(endpoint, {
        auth: { token: createToken("TRAFFIC_AUTHORITY") },
        reconnection: false,
        timeout: 2000,
      });
      await new Promise((resolve, reject) => {
        authorizedClient.once("connect", resolve);
        authorizedClient.once("connect_error", reject);
      });

      const notification = new Promise((resolve) =>
        authorizedClient.once(REALTIME_EVENTS.MEASUREMENT_CREATED, resolve)
      );
      realtimeService.publishMeasurementCreated({
        _id: "measurement-network-test",
        source: "API",
        vehicleCount: 12,
      });
      const payload = await notification;
      assert.equal(payload.measurementId, "measurement-network-test");
      assert.equal(payload.vehicleCount, 12);

      unauthorizedClient = socketClient(endpoint, {
        auth: { token: "invalid-token" },
        reconnection: false,
        timeout: 2000,
      });
      const connectionError = await new Promise((resolve) =>
        unauthorizedClient.once("connect_error", resolve)
      );
      assert.equal(connectionError.data.code, "UNAUTHORIZED");
      assert.equal(unauthorizedClient.connected, false);
    } finally {
      authorizedClient?.disconnect();
      unauthorizedClient?.disconnect();
      realtimeService.detach(io);
      await new Promise((resolve) => io.close(resolve));
    }
  });
});

describe("persisted realtime event publishing", () => {
  test("publishes a sanitized measurement event only after the measurement save", async () => {
    const order = [];
    const recorder = createIoRecorder(order);
    realtimeService.attach(recorder.io);
    mock.method(TrafficMeasurement.prototype, "save", async function () {
      this._id = new mongoose.Types.ObjectId();
      order.push("measurement-saved");
      return this;
    });
    mock.method(
      trafficMeasurementRecoveryWorker,
      "processMeasurementNow",
      async () => ({ completed: true, congestionDetected: false })
    );

    try {
      const result = await recordTrafficMeasurement({
        device: new mongoose.Types.ObjectId(),
        location: new mongoose.Types.ObjectId(),
        vehicleCount: 30,
        averageSpeed: 40,
        trafficDensity: "LOW",
      });

      assert.deepEqual(order, [
        "measurement-saved",
        `emit:${REALTIME_EVENTS.MEASUREMENT_CREATED}`,
      ]);
      assert.equal(recorder.events.length, 1);
      assert.equal(
        recorder.events[0].payload.measurementId,
        String(result.measurement._id)
      );
      assert.equal(recorder.events[0].payload.source, "API");
      assert.deepEqual(
        Object.keys(recorder.events[0].payload).sort(),
        [
          "averageSpeed",
          "deviceId",
          "locationId",
          "measuredAt",
          "measurementId",
          "source",
          "trafficDensity",
          "vehicleCount",
        ].sort()
      );
    } finally {
      realtimeService.detach(recorder.io);
    }
  });

  test("does not publish a measurement event when persistence fails", async () => {
    const recorder = createIoRecorder();
    realtimeService.attach(recorder.io);
    mock.method(TrafficMeasurement.prototype, "save", async () => {
      throw new Error("measurement persistence failed");
    });

    try {
      await assert.rejects(
        recordTrafficMeasurement({
          device: new mongoose.Types.ObjectId(),
          location: new mongoose.Types.ObjectId(),
          vehicleCount: 30,
          averageSpeed: 40,
          trafficDensity: "LOW",
        }),
        /measurement persistence failed/
      );
      assert.equal(recorder.events.length, 0);
    } finally {
      realtimeService.detach(recorder.io);
    }
  });

  test("publishes a congestion event once after persistence and not on duplicate detection", async () => {
    const order = [];
    const recorder = createIoRecorder(order);
    realtimeService.attach(recorder.io);
    const measurementId = new mongoose.Types.ObjectId();
    let existingEvent = null;
    const measurement = {
      _id: measurementId,
      location: new mongoose.Types.ObjectId(),
      vehicleCount: 125,
      averageSpeed: 12,
    };
    mock.method(TrafficMeasurement, "findById", async () => measurement);
    mock.method(CongestionEvent, "findOne", async () => existingEvent);
    mock.method(CongestionEvent.prototype, "save", async function () {
      order.push("event-saved");
      return this;
    });

    try {
      const result = await congestionDetectionService.detectCongestion(
        measurementId
      );
      assert.equal(result.congestionDetected, true);
      assert.deepEqual(order, [
        "event-saved",
        `emit:${REALTIME_EVENTS.CONGESTION_DETECTED}`,
      ]);
      assert.equal(recorder.events.length, 1);
      assert.equal(
        recorder.events[0].payload.measurementId,
        String(measurementId)
      );
      assert.equal("description" in recorder.events[0].payload, false);

      existingEvent = result.event;
      const repeated = await congestionDetectionService.detectCongestion(
        measurementId
      );
      assert.equal(repeated.event, result.event);
      assert.equal(recorder.events.length, 1);
    } finally {
      realtimeService.detach(recorder.io);
    }
  });

  test("publishes an alert once after persistence and suppresses duplicate alerts", async () => {
    const order = [];
    const recorder = createIoRecorder(order);
    realtimeService.attach(recorder.io);
    const eventId = new mongoose.Types.ObjectId();
    let existingAlert = null;
    const event = {
      _id: eventId,
      location: new mongoose.Types.ObjectId(),
      congestionLevel: "SEVERE",
    };
    mock.method(CongestionEvent, "findById", async () => event);
    mock.method(TrafficAlert, "findOne", async () => existingAlert);
    mock.method(TrafficAlert.prototype, "save", async function () {
      order.push("alert-saved");
      return this;
    });

    try {
      const result = await trafficAlertService.createCongestionAlert(eventId);
      assert.equal(result.alertCreated, true);
      assert.deepEqual(order, [`alert-saved`, `emit:${REALTIME_EVENTS.ALERT_CREATED}`]);
      assert.equal(recorder.events.length, 1);
      assert.equal(recorder.events[0].payload.severity, "CRITICAL");

      existingAlert = result.alert;
      const repeated = await trafficAlertService.createCongestionAlert(eventId);
      assert.equal(repeated.alertCreated, false);
      assert.equal(recorder.events.length, 1);
    } finally {
      realtimeService.detach(recorder.io);
    }
  });
});

test("Socket.IO publisher disconnect detaches only its own server instance", () => {
  const recorder = createIoRecorder();
  realtimeService.attach(recorder.io);
  realtimeService.detach({});
  realtimeService.publishMeasurementCreated({ _id: "measurement-id" });
  assert.equal(recorder.events.length, 1);
  realtimeService.detach(recorder.io);
  realtimeService.publishMeasurementCreated({ _id: "measurement-id" });
  assert.equal(recorder.events.length, 1);
});

describe("frontend realtime listener lifecycle", () => {
  test("shares event listeners, delivers once per callback, and cleans up on unmount", async () => {
    const { createRealtimeClient } = await import(
      "../../frontend/src/services/realtime.js"
    );
    const sockets = [];
    const client = createRealtimeClient((url, options) => {
      const listeners = new Map();
      const managerListeners = new Map();
      const fakeSocket = {
        url,
        options,
        io: {
          on(name, handler) {
            managerListeners.set(name, handler);
          },
          removeAllListeners() {
            managerListeners.clear();
          },
        },
        on(name, handler) {
          const handlers = listeners.get(name) || new Set();
          handlers.add(handler);
          listeners.set(name, handlers);
        },
        off(name, handler) {
          listeners.get(name)?.delete(handler);
        },
        emit(name, payload) {
          for (const handler of listeners.get(name) || []) handler(payload);
        },
        connect() {
          this.connected = true;
        },
        disconnect() {
          this.connected = false;
        },
        removeAllListeners() {
          listeners.clear();
        },
        listenerCount(name) {
          return listeners.get(name)?.size || 0;
        },
      };
      sockets.push(fakeSocket);
      return fakeSocket;
    }, "http://localhost:5000");
    const onEvent = mock.fn();
    const onStatus = mock.fn();

    const unsubscribeFirst = client.subscribe(
      "signed-session-token",
      [REALTIME_EVENTS.ALERT_CREATED],
      onEvent,
      onStatus
    );
    const unsubscribeSecond = client.subscribe(
      "signed-session-token",
      [REALTIME_EVENTS.ALERT_CREATED],
      onEvent
    );

    assert.equal(sockets.length, 1);
    assert.deepEqual(sockets[0].options.auth, { token: "signed-session-token" });
    assert.equal(sockets[0].listenerCount(REALTIME_EVENTS.ALERT_CREATED), 1);
    sockets[0].emit(REALTIME_EVENTS.ALERT_CREATED, { alertId: "alert-1" });
    assert.equal(onEvent.mock.callCount(), 1);

    unsubscribeFirst();
    sockets[0].emit(REALTIME_EVENTS.ALERT_CREATED, { alertId: "alert-2" });
    assert.equal(onEvent.mock.callCount(), 2);

    unsubscribeSecond();
    sockets[0].emit(REALTIME_EVENTS.ALERT_CREATED, { alertId: "alert-3" });
    assert.equal(onEvent.mock.callCount(), 2);
    assert.equal(sockets[0].connected, false);
    assert.equal(client.getStatus(), "disconnected");
    assert.ok(onStatus.mock.callCount() > 0);
  });
});
