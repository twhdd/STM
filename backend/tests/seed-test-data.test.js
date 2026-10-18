const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  assertConnectedDatabaseName,
  databaseNameFromUri,
  upsertSeedRecord,
  validateIntegrationEnvironment,
  validateEnvironment,
} = require("../scripts/seed-test-data");

const validEnvironment = () => ({
  NODE_ENV: "development",
  STM_TEST_DATA_CONFIRM: "YES",
  STM_TEST_DATABASE_NAME: "stm_test",
  MONGO_URI: "mongodb+srv://test-cluster.example.mongodb.net/stm_test?retryWrites=true",
});

test("test data seed selects stm_test explicitly when the URI has that database path", () => {
  const config = validateEnvironment(validEnvironment());
  assert.equal(config.databaseName, "stm_test");
});

test("test data seed selects stm_test explicitly when the URI has no database path", () => {
  const config = validateEnvironment({
    ...validEnvironment(),
    MONGO_URI: "mongodb+srv://test-cluster.example.mongodb.net/?retryWrites=true",
  });
  assert.equal(config.databaseName, "stm_test");
});

test("test data seed rejects any URI database other than stm_test", () => {
  assert.throws(
    () =>
      validateEnvironment({
        ...validEnvironment(),
        MONGO_URI: "mongodb+srv://test-cluster.example.mongodb.net/app",
      }),
    /must be stm_test when present/
  );
});

test("test data seed requires explicit development, confirmation, and exact database settings", () => {
  for (const override of [
    { NODE_ENV: "production" },
    { NODE_ENV: undefined },
    { STM_TEST_DATA_CONFIRM: undefined },
    { STM_TEST_DATABASE_NAME: "other_test" },
    { STM_TEST_DATABASE_NAME: undefined },
  ]) {
    assert.throws(
      () => validateEnvironment({ ...validEnvironment(), ...override }),
      Error
    );
  }
});

test("test data seed accepts only MongoDB URI protocols", () => {
  assert.throws(
    () => databaseNameFromUri("https://test-cluster.example.net/stm_test"),
    /mongodb or mongodb\+srv/
  );
});

test("integration tests accept an explicitly configured isolated test database", () => {
  const environment = {
    ...validEnvironment(),
    STM_TEST_DATABASE_NAME: "stm_congestion_it_test",
    STM_RUN_TRAFFIC_PROCESSING_INTEGRATION: "YES",
    MONGO_URI:
      "mongodb+srv://test-cluster.example.mongodb.net/stm_congestion_it_test?retryWrites=true",
  };

  assert.deepEqual(validateIntegrationEnvironment(environment), {
    mongoUri: environment.MONGO_URI,
    databaseName: "stm_congestion_it_test",
  });
});

test("integration tests allow selecting the configured database for a URI without a path", () => {
  const environment = {
    ...validEnvironment(),
    STM_TEST_DATABASE_NAME: "stm_congestion_it_test",
    STM_RUN_TRAFFIC_PROCESSING_INTEGRATION: "YES",
    MONGO_URI: "mongodb+srv://test-cluster.example.mongodb.net/?retryWrites=true",
  };

  assert.equal(
    validateIntegrationEnvironment(environment).databaseName,
    "stm_congestion_it_test"
  );
});

test("integration tests reject missing opt-ins, unsafe database names, and URI mismatches", () => {
  const base = {
    ...validEnvironment(),
    STM_TEST_DATABASE_NAME: "stm_congestion_it_test",
    STM_RUN_TRAFFIC_PROCESSING_INTEGRATION: "YES",
    MONGO_URI:
      "mongodb+srv://test-cluster.example.mongodb.net/stm_congestion_it_test",
  };

  for (const override of [
    { NODE_ENV: "production" },
    { NODE_ENV: "test" },
    { STM_TEST_DATA_CONFIRM: "NO" },
    { STM_RUN_TRAFFIC_PROCESSING_INTEGRATION: undefined },
    { STM_RUN_TRAFFIC_PROCESSING_INTEGRATION: "NO" },
    { STM_TEST_DATABASE_NAME: undefined },
    { STM_TEST_DATABASE_NAME: "stm_production_test" },
    { STM_TEST_DATABASE_NAME: "stm_prod_test" },
    { STM_TEST_DATABASE_NAME: "stm_live_test" },
    { STM_TEST_DATABASE_NAME: "stm_staging_test" },
    { STM_TEST_DATABASE_NAME: "stm_production" },
    { STM_TEST_DATABASE_NAME: "stm.test" },
    { MONGO_URI: undefined },
    {
      MONGO_URI:
        "https://test-cluster.example.mongodb.net/stm_congestion_it_test",
    },
    {
      MONGO_URI:
        "mongodb+srv://test-cluster.example.mongodb.net/another_test",
    },
  ]) {
    assert.throws(
      () => validateIntegrationEnvironment({ ...base, ...override }),
      Error
    );
  }
});

test("integration tests verify the connected database name before test writes", () => {
  assert.doesNotThrow(() =>
    assertConnectedDatabaseName("stm_congestion_it_test", "stm_congestion_it_test")
  );
  assert.throws(
    () => assertConnectedDatabaseName("stm_test", "stm_congestion_it_test"),
    /does not match the guarded test database/
  );
});

test("seed records use upserts and do not delete or reset mutable record state", async () => {
  let call;
  const model = {
    findOneAndUpdate: async (...args) => {
      call = args;
      return { _id: "seed-record" };
    },
  };

  const result = await upsertSeedRecord(
    model,
    { routeId: "STM-TEST-ROUTE-001" },
    { name: "Seed route" },
    { status: "AVAILABLE" }
  );

  assert.equal(result._id, "seed-record");
  assert.deepEqual(call[0], { routeId: "STM-TEST-ROUTE-001" });
  assert.deepEqual(call[1], {
    $set: { name: "Seed route" },
    $setOnInsert: { status: "AVAILABLE" },
  });
  assert.equal(call[2].upsert, true);
  assert.equal(call[2].returnDocument, "after");
  assert.equal(call[2].runValidators, true);
});
