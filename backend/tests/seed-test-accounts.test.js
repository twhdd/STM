const { test, mock, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const User = require("../models/User");
const {
  assertConnectedDatabaseName,
  databaseNameFromUri,
  ensureAccounts,
  validateEnvironment,
} = require("../scripts/seed-test-accounts");

afterEach(() => mock.restoreAll());

const validEnvironment = () => ({
  NODE_ENV: "development",
  STM_TEST_ACCOUNTS_CONFIRM: "YES",
  STM_TEST_ACCOUNT_PASSWORD: ["X".repeat(5), "x".repeat(5), "7".repeat(3), "!".repeat(3)].join(""),
  STM_TEST_DATABASE_NAME: "stm_role_test",
  MONGO_URI: "mongodb://127.0.0.1:27017/stm_role_test",
  JWT_SECRET: "configured-for-test-verification",
});

test("test seed configuration accepts an explicitly named test database", () => {
  const configuration = validateEnvironment(validEnvironment());
  assert.equal(configuration.databaseName, "stm_role_test");
  assert.equal(configuration.mongoUri, "mongodb://127.0.0.1:27017/stm_role_test");
});

test("test seed allows an empty URI database path only with an explicit test database name", () => {
  const configuration = validateEnvironment({
    ...validEnvironment(),
    MONGO_URI: "mongodb://127.0.0.1:27017",
    STM_TEST_DATABASE_NAME: "STM_ROLE_TEST",
  });
  assert.equal(configuration.databaseName, "STM_ROLE_TEST");
  assert.equal(configuration.mongoUri, "mongodb://127.0.0.1:27017");

  assert.throws(
    () =>
      validateEnvironment({
        ...validEnvironment(),
        MONGO_URI: "mongodb://127.0.0.1:27017",
        STM_TEST_DATABASE_NAME: undefined,
      }),
    /must be a safe test database name/
  );
});

test("test seed refuses production and non-development environments", () => {
  assert.throws(
    () => validateEnvironment({ ...validEnvironment(), NODE_ENV: "production" }),
    /disabled in production/
  );
  assert.throws(
    () => validateEnvironment({ ...validEnvironment(), NODE_ENV: "test" }),
    /Set NODE_ENV=development/
  );
});

test("test seed requires explicit account-creation confirmation", () => {
  assert.throws(
    () => validateEnvironment({ ...validEnvironment(), STM_TEST_ACCOUNTS_CONFIRM: undefined }),
    /STM_TEST_ACCOUNTS_CONFIRM=YES/
  );
});

test("test seed rejects missing or weak passwords without returning them", () => {
  for (const password of [undefined, "short"]) {
    assert.throws(
      () =>
        validateEnvironment({
          ...validEnvironment(),
          STM_TEST_ACCOUNT_PASSWORD: password,
        }),
      /at least 16 characters/
    );
  }
});

test("test seed requires the configured database name to match the test URI", () => {
  assert.throws(
    () =>
      validateEnvironment({
        ...validEnvironment(),
        STM_TEST_DATABASE_NAME: "stm_production",
        MONGO_URI: "mongodb://127.0.0.1:27017/stm_production",
      }),
    /must be a safe test database name/
  );
  assert.throws(
    () =>
      validateEnvironment({
        ...validEnvironment(),
        STM_TEST_DATABASE_NAME: "stm_other_test",
      }),
    /must exactly match the database name in MONGO_URI/
  );
  assert.throws(
    () =>
      validateEnvironment({
        ...validEnvironment(),
        STM_TEST_DATABASE_NAME: "STM_ROLE_TEST",
      }),
    /must exactly match the database name in MONGO_URI/
  );
});

test("test seed rejects production, live, or staging database-name segments", () => {
  for (const databaseName of [
    "stm_production_test",
    "stm_prod_test",
    "stm_live_test",
    "stm_staging_test",
  ]) {
    assert.throws(
      () =>
        validateEnvironment({
          ...validEnvironment(),
          STM_TEST_DATABASE_NAME: databaseName,
          MONGO_URI: `mongodb://127.0.0.1:27017/${databaseName}`,
        }),
      /must be a safe test database name/
    );
  }
});

test("test seed rejects a URI path that differs from the configured database", () => {
  assert.throws(
    () =>
      validateEnvironment({
        ...validEnvironment(),
        MONGO_URI: "mongodb://127.0.0.1:27017/stm_other_test",
      }),
    /must exactly match the database name in MONGO_URI/
  );
});

test("test seed rejects a connected database name that differs from configuration", () => {
  assert.doesNotThrow(() =>
    assertConnectedDatabaseName("stm_role_test", "stm_role_test")
  );
  assert.throws(
    () => assertConnectedDatabaseName("stm_other_test", "stm_role_test"),
    /Connected database name does not match the guarded test database/
  );
});

test("test seed rejects invalid Mongo URI protocols", () => {
  assert.throws(() => databaseNameFromUri("https://example.test/database"), /mongodb or mongodb\+srv/);
});

test("test seed reports role conflicts before creating any accounts", async () => {
  let created = 0;
  mock.method(User, "findOne", async () => ({ role: "CITIZEN" }));
  mock.method(User, "create", async () => {
    created += 1;
  });

  await assert.rejects(
    ensureAccounts(validEnvironment().STM_TEST_ACCOUNT_PASSWORD),
    /Existing test-account role conflict/
  );
  assert.equal(created, 0);
});

test("test seed is idempotent and retains existing account documents", async () => {
  const accounts = new Map();
  let created = 0;
  mock.method(User, "findOne", async ({ email }) => accounts.get(email) || null);
  mock.method(User, "create", async (document) => {
    created += 1;
    accounts.set(document.email, { ...document });
    return accounts.get(document.email);
  });
  mock.method(console, "log", () => {});

  const password = validEnvironment().STM_TEST_ACCOUNT_PASSWORD;
  await ensureAccounts(password);
  const firstSeed = new Map(accounts);
  await ensureAccounts(password);

  assert.equal(created, 5);
  assert.equal(accounts.size, 5);
  for (const [email, seededAccount] of firstSeed) {
    assert.deepEqual(accounts.get(email), seededAccount);
    assert.notEqual(seededAccount.password, password);
  }
});
