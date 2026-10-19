const { test } = require("node:test");
const assert = require("node:assert/strict");
const connectDB = require("../config/database");

test("database connection selects the explicitly configured test database", async () => {
  const logs = [];
  const connectCalls = [];
  const logger = { log: (...values) => logs.push(values), error() {} };
  const mongooseInstance = {
    connection: { name: "stm_test" },
    async connect(uri, options) {
      connectCalls.push([uri, options]);
    },
  };

  await connectDB({
    environment: {
      MONGO_URI: "mongodb://database.example/",
      STM_TEST_DATABASE_NAME: "stm_test",
    },
    mongooseInstance,
    logger,
    exitProcess() {
      assert.fail("connection should not exit");
    },
  });

  assert.deepEqual(connectCalls, [
    ["mongodb://database.example/", { dbName: "stm_test" }],
  ]);
  assert.match(logs.at(-1)[0], /database: stm_test/);
});

test("development defaults to stm_test when a pathless URI has no database override", () => {
  assert.deepEqual(connectDB.getConnectionOptions({ NODE_ENV: "development" }), {
    dbName: "stm_test",
  });
});

test("an unspecified environment retains the development stm_test default", () => {
  assert.deepEqual(connectDB.getConnectionOptions({}), { dbName: "stm_test" });
});

test("an explicit integration database override remains isolated from stm_test", () => {
  assert.deepEqual(
    connectDB.getConnectionOptions({
      NODE_ENV: "development",
      STM_TEST_DATABASE_NAME: "stm_simulator_it_test",
    }),
    { dbName: "stm_simulator_it_test" }
  );
});

test("production leaves database selection to its explicitly named URI", () => {
  assert.deepEqual(connectDB.getConnectionOptions({ NODE_ENV: "production" }), {});
});

test("database connection refuses an unguarded test database override", () => {
  assert.throws(
    () => connectDB.getConnectionOptions({ STM_TEST_DATABASE_NAME: "application" }),
    /must contain 'test'/
  );
});
