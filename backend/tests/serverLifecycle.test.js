const { test } = require("node:test");
const assert = require("node:assert/strict");
const app = require("../server");

test("startup starts recovery after lifecycle preflight and shutdown drains it", async () => {
  const operations = [];
  let httpServer;
  const runtime = await app.startServer({
    port: 0,
    appInstance(_request, response) {
      response.end("ok");
    },
    connectDatabase: async () => operations.push("database-connected"),
    ensureLifecycleIndexes: async () => operations.push("lifecycle-preflight"),
    recoveryWorker: {
      async start() {
        operations.push("recovery-started");
      },
      async stop() {
        operations.push("recovery-stopped");
      },
    },
    simulator: {
      async start() {
        operations.push("simulator-started");
      },
      async stop() {
        operations.push("simulator-stopped");
      },
    },
    socketServerFactory(server) {
      httpServer = server;
      return {
        close(callback) {
          operations.push("socket-closed");
          server.close(callback);
        },
      };
    },
    realtime: {
      attach() {
        operations.push("realtime-attached");
      },
      detach() {
        operations.push("realtime-detached");
      },
    },
    registerSignalHandlers: false,
  });

  assert.deepEqual(operations.slice(0, 4), [
    "database-connected",
    "lifecycle-preflight",
    "recovery-started",
    "realtime-attached",
  ]);
  assert.equal(httpServer.listening, true);

  await runtime.shutdown();
  assert.deepEqual(operations.slice(-4), [
    "simulator-stopped",
    "socket-closed",
    "realtime-detached",
    "recovery-stopped",
  ]);
});

test("startup does not start recovery if lifecycle preflight fails", async () => {
  let recoveryStarted = false;
  await assert.rejects(
    app.startServer({
      connectDatabase: async () => {},
      ensureLifecycleIndexes: async () => {
        throw new Error("lifecycle conflict");
      },
      recoveryWorker: {
        async start() {
          recoveryStarted = true;
        },
      },
    }),
    /lifecycle conflict/
  );
  assert.equal(recoveryStarted, false);
});
