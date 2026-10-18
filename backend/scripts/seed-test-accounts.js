require("dotenv").config();

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");
const app = require("../server");
const {
  assertConnectedDatabaseName: assertGuardedDatabaseName,
  validateTestDatabaseName: validateGuardedTestDatabaseName,
} = require("./seed-test-data");

const TEST_ACCOUNTS = Object.freeze([
  { email: "stm.admin.test@example.com", role: "ADMIN", fullName: "STM Admin Test" },
  {
    email: "stm.authority.test@example.com",
    role: "TRAFFIC_AUTHORITY",
    fullName: "STM Traffic Authority Test",
  },
  {
    email: "stm.police.test@example.com",
    role: "TRAFFIC_POLICE",
    fullName: "STM Traffic Police Test",
  },
  {
    email: "stm.emergency.test@example.com",
    role: "EMERGENCY_SERVICE",
    fullName: "STM Emergency Service Test",
  },
  { email: "stm.citizen.test@example.com", role: "CITIZEN", fullName: "STM Citizen Test" },
]);

class SeedConfigurationError extends Error {}

function databaseNameFromUri(mongoUri) {
  let parsedUri;
  try {
    parsedUri = new URL(mongoUri);
  } catch {
    throw new SeedConfigurationError("MONGO_URI must be a valid MongoDB connection URI.");
  }

  if (!["mongodb:", "mongodb+srv:"].includes(parsedUri.protocol)) {
    throw new SeedConfigurationError("MONGO_URI must use the mongodb or mongodb+srv protocol.");
  }

  try {
    return decodeURIComponent(parsedUri.pathname.replace(/^\/+/, "").split("/")[0]);
  } catch {
    throw new SeedConfigurationError("MONGO_URI contains an invalid database name.");
  }
}

function validateTestDatabaseName(databaseName) {
  try {
    return validateGuardedTestDatabaseName(databaseName);
  } catch (error) {
    throw new SeedConfigurationError(error.message);
  }
}

function assertConnectedDatabaseName(connectedDatabaseName, expectedDatabaseName) {
  try {
    assertGuardedDatabaseName(connectedDatabaseName, expectedDatabaseName);
  } catch (error) {
    throw new SeedConfigurationError(error.message);
  }
}

function validateEnvironment(environment) {
  if (environment.NODE_ENV === "production") {
    throw new SeedConfigurationError("Test-account seeding is disabled in production.");
  }
  if (environment.NODE_ENV !== "development") {
    throw new SeedConfigurationError("Set NODE_ENV=development to run the test-account seeder.");
  }
  if (environment.STM_TEST_ACCOUNTS_CONFIRM !== "YES") {
    throw new SeedConfigurationError(
      "Set STM_TEST_ACCOUNTS_CONFIRM=YES to explicitly confirm test-account creation."
    );
  }

  const password = environment.STM_TEST_ACCOUNT_PASSWORD;
  if (
    typeof password !== "string" ||
    password.length < 16 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    throw new SeedConfigurationError(
      "STM_TEST_ACCOUNT_PASSWORD must be at least 16 characters and include lowercase, uppercase, numeric, and symbol characters."
    );
  }

  if (!environment.MONGO_URI) {
    throw new SeedConfigurationError("MONGO_URI must point to a dedicated test database.");
  }

  const uriDatabaseName = databaseNameFromUri(environment.MONGO_URI);
  const configuredDatabaseName = validateTestDatabaseName(environment.STM_TEST_DATABASE_NAME);
  if (uriDatabaseName && uriDatabaseName !== configuredDatabaseName) {
    throw new SeedConfigurationError(
      "STM_TEST_DATABASE_NAME must exactly match the database name in MONGO_URI."
    );
  }

  if (!environment.JWT_SECRET) {
    throw new SeedConfigurationError(
      "JWT_SECRET must be configured to verify login through the existing authentication endpoint."
    );
  }

  return {
    mongoUri: environment.MONGO_URI,
    databaseName: configuredDatabaseName,
    password,
    jwtSecret: environment.JWT_SECRET,
  };
}

async function ensureAccounts(password) {
  const existingAccounts = await Promise.all(
    TEST_ACCOUNTS.map(async (account) => ({
      account,
      existing: await User.findOne({ email: account.email }),
    }))
  );

  const conflicts = existingAccounts
    .filter(({ account, existing }) => existing && existing.role !== account.role)
    .map(({ account, existing }) => `${account.email} (expected ${account.role}, found ${existing.role})`);

  if (conflicts.length > 0) {
    throw new Error(`Existing test-account role conflict(s): ${conflicts.join("; ")}`);
  }

  for (const { account, existing } of existingAccounts) {
    if (existing) {
      console.log(`Existing account retained: ${account.email} (${account.role})`);
      continue;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await User.create({
      email: account.email,
      fullName: account.fullName,
      password: passwordHash,
      role: account.role,
    });
    console.log(`Created account: ${account.email} (${account.role})`);
  }
}

async function startLocalServer() {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
}

async function verifyLogins(server, jwtSecret, password) {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  for (const account of TEST_ACCOUNTS) {
    let response;
    let data;

    try {
      response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: account.email, password }),
      });
      data = await response.json();
    } catch {
      throw new Error(`Login endpoint verification failed for ${account.email}.`);
    }

    if (
      !response.ok ||
      data?.success !== true ||
      data?.user?.email !== account.email ||
      data?.user?.role !== account.role ||
      typeof data?.token !== "string"
    ) {
      throw new Error(
        `Login endpoint verification failed for ${account.email} (HTTP ${response.status}); existing passwords are never reset.`
      );
    }

    let tokenPayload;
    try {
      tokenPayload = jwt.verify(data.token, jwtSecret, { algorithms: ["HS256"] });
    } catch {
      throw new Error(`Login token verification failed for ${account.email}.`);
    }

    if (tokenPayload.role !== account.role || String(tokenPayload.userId) !== data.user.id) {
      throw new Error(`Login token role verification failed for ${account.email}.`);
    }

    console.log(`Login verified: ${account.email} (${account.role})`);
  }
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function run() {
  const configuration = validateEnvironment(process.env);
  let server;

  try {
    await mongoose.connect(configuration.mongoUri, {
      dbName: configuration.databaseName,
    });
    assertConnectedDatabaseName(mongoose.connection.name, configuration.databaseName);
    await ensureAccounts(configuration.password);
    server = await startLocalServer();
    await verifyLogins(server, configuration.jwtSecret, configuration.password);
    console.log("All five test accounts have the expected roles and authenticated successfully.");
  } finally {
    await closeServer(server);
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run().catch((error) => {
    if (error instanceof SeedConfigurationError) {
      console.error(error.message);
    } else if (error.message.startsWith("Existing test-account role conflict")) {
      console.error(error.message);
    } else if (error.message.startsWith("Login ") || error.message.startsWith("Login endpoint")) {
      console.error(error.message);
    } else {
      console.error(
        "Test-account seeding or verification failed. Check test-database availability and account uniqueness; no existing role or password was changed."
      );
    }
    process.exitCode = 1;
  });
}

module.exports = {
  databaseNameFromUri,
  assertConnectedDatabaseName,
  ensureAccounts,
  validateEnvironment,
};
