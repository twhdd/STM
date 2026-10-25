// Authentication / authorization tests. Run: npm test (from backend/)
// No database needed: Mongoose buffering is off so handlers that reach the DB
// fail fast with 500 (which proves auth let the request through), and the
// handful of tests that need real responses stub the model methods.
process.env.JWT_SECRET = "test-secret-for-auth-tests";

const { test, describe, before, after, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

mongoose.set("bufferCommands", false);

const app = require("../server");
const User = require("../models/User");
const TrafficLocation = require("../models/TrafficLocation");
const CitizenReport = require("../models/CitizenReport");

const SECRET = process.env.JWT_SECRET;
const ID = "507f1f77bcf86cd799439011"; // a syntactically valid ObjectId
const OTHER_ID = "507f1f77bcf86cd799439022";

const ROLES = [
  "ADMIN",
  "TRAFFIC_AUTHORITY",
  "TRAFFIC_POLICE",
  "EMERGENCY_SERVICE",
  "CITIZEN",
];
const STAFF = ["ADMIN", "TRAFFIC_AUTHORITY", "TRAFFIC_POLICE", "EMERGENCY_SERVICE"];
const ADMIN_TA = ["ADMIN", "TRAFFIC_AUTHORITY"];

// ---------------------------------------------------------------------------
// The reviewed authorization decision for EVERY registered route.
// "PUBLIC" = no token needed; "AUTH" = any authenticated role; array = roles.
// ---------------------------------------------------------------------------
const MATRIX = {
  "POST /api/auth/register": "PUBLIC",
  "POST /api/auth/login": "PUBLIC",
  "POST /api/auth/users": ["ADMIN"],

  "POST /api/traffic-locations": ADMIN_TA,
  "GET /api/traffic-locations": "AUTH",
  "GET /api/traffic-locations/:id": "AUTH",

  "POST /api/monitoring-devices": ADMIN_TA,
  "GET /api/monitoring-devices": STAFF,
  "GET /api/monitoring-devices/:id": STAFF,

  "POST /api/traffic-measurements": ["ADMIN", "TRAFFIC_AUTHORITY", "TRAFFIC_POLICE"],
  "GET /api/traffic-measurements": "AUTH",
  "GET /api/traffic-measurements/:id": "AUTH",

  "POST /api/traffic-signals": ADMIN_TA,
  "GET /api/traffic-signals": STAFF,
  "GET /api/traffic-signals/:id": STAFF,

  "POST /api/signal-optimization/optimize": ADMIN_TA,

  "POST /api/emergency-vehicles": ["ADMIN", "EMERGENCY_SERVICE"],
  "GET /api/emergency-vehicles": STAFF,
  "GET /api/emergency-vehicles/:id": STAFF,

  "POST /api/emergency-priority/activate": ["ADMIN", "EMERGENCY_SERVICE"],
  "POST /api/emergency-priority/deactivate": ["ADMIN", "EMERGENCY_SERVICE"],

  "POST /api/routes": ADMIN_TA,
  "GET /api/routes": "AUTH",
  "GET /api/routes/:id": "AUTH",
  "PATCH /api/routes/:id/waypoints": ADMIN_TA,

  "POST /api/route-recommendation/recommend": "AUTH",

  "POST /api/traffic-alerts/generate": ADMIN_TA,
  "GET /api/traffic-alerts": "AUTH",
  "GET /api/traffic-alerts/:id": "AUTH",

  "GET /api/traffic-analytics": "AUTH",

  "POST /api/congestion-events/detect": ADMIN_TA,
  "GET /api/congestion-events": "AUTH",
  "GET /api/congestion-events/:id": "AUTH",

  "POST /api/citizen-reports": "AUTH",
  "GET /api/citizen-reports": "AUTH",
  "GET /api/citizen-reports/:id": "AUTH",
  "PATCH /api/citizen-reports/:id/review": [
    "ADMIN",
    "TRAFFIC_AUTHORITY",
    "TRAFFIC_POLICE",
  ],

  "POST /api/traffic-vision/jobs": "AUTH",
  "GET /api/traffic-vision/jobs": "AUTH",
  "GET /api/traffic-vision/jobs/:id": "AUTH",
  "GET /api/traffic-vision/jobs/:id/results": "AUTH",
  "GET /api/traffic-vision/jobs/:id/annotated-video": "AUTH",
  "GET /api/traffic-vision/jobs/:id/result-file": "AUTH",
};

// Endpoints defined directly in server.js (not in a router file)
const PUBLIC_INLINE = ["GET /", "GET /api/health"];

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

afterEach(() => mock.restoreAll());

const tokenFor = (role, userId = ID, options = { expiresIn: "1h" }) =>
  jwt.sign({ userId, role }, SECRET, options);

async function call(method, urlPath, { token, headers = {}, body } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h["Content-Type"] = "application/json";

  const res = await fetch(baseUrl + urlPath, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: json };
}

const concretePath = (key) => key.split(" ")[1].replace(":id", ID);
const methodOf = (key) => key.split(" ")[0];

// A thenable stand-in for a Mongoose query: supports common query chaining
function query(result) {
  const q = {
    populate: () => q,
    select: () => q,
    sort: () => q,
    skip: () => q,
    limit: () => q,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return q;
}

// ---------------------------------------------------------------------------
// 1. Inventory: every registered route is reviewed, none is stale
// ---------------------------------------------------------------------------
describe("route inventory", () => {
  function discoverRoutes() {
    const serverSrc = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");

    const varToFile = {};
    for (const m of serverSrc.matchAll(/const (\w+) = require\("\.\/routes\/(\w+)"\)/g)) {
      varToFile[m[1]] = m[2];
    }

    const found = [];
    for (const m of serverSrc.matchAll(/app\.use\(\s*"([^"]+)"\s*,\s*(\w+)\s*\)/g)) {
      const [, prefix, variable] = m;
      if (!varToFile[variable]) continue; // not a router mount
      const router = require(`../routes/${varToFile[variable]}`);
      for (const layer of router.stack) {
        if (!layer.route) continue;
        for (const method of Object.keys(layer.route.methods)) {
          const sub = layer.route.path === "/" ? "" : layer.route.path;
          found.push(`${method.toUpperCase()} ${prefix}${sub}`);
        }
      }
    }
    return found;
  }

  test("every registered route has a reviewed authorization decision", () => {
    const found = discoverRoutes().sort();
    assert.ok(found.length > 0, "no routes discovered");
    assert.deepEqual(found, Object.keys(MATRIX).sort());
  });

  test("the only public endpoints are the documented ones", () => {
    const publicRoutes = Object.entries(MATRIX)
      .filter(([, rule]) => rule === "PUBLIC")
      .map(([key]) => key)
      .sort();
    assert.deepEqual(publicRoutes, ["POST /api/auth/login", "POST /api/auth/register"]);
  });
});

// ---------------------------------------------------------------------------
// 2. Unauthenticated requests
// ---------------------------------------------------------------------------
describe("unauthenticated requests", () => {
  for (const [key, rule] of Object.entries(MATRIX)) {
    if (rule === "PUBLIC") continue;
    test(`${key} -> 401 without a token`, async () => {
      const res = await call(methodOf(key), concretePath(key), { body: methodOf(key) === "POST" ? {} : undefined });
      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
    });
  }

  test("public endpoints do not demand a token", async () => {
    for (const key of PUBLIC_INLINE) {
      const res = await call(methodOf(key), key.split(" ")[1]);
      assert.equal(res.status, 200, key);
    }
    // login/register reach their handler (400 for the empty body), not 401
    const login = await call("POST", "/api/auth/login", { body: {} });
    const register = await call("POST", "/api/auth/register", { body: {} });
    assert.equal(login.status, 400);
    assert.equal(register.status, 400);
  });
});

// ---------------------------------------------------------------------------
// 3. Invalid / expired tokens (one representative route per rule type)
// ---------------------------------------------------------------------------
describe("invalid and expired tokens", () => {
  const target = "/api/traffic-locations"; // any-authenticated route

  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

  const badAuthHeaders = {
    "non-Bearer scheme": { Authorization: "Basic abc123" },
    "Bearer with no token": { Authorization: "Bearer" },
    "malformed token": { Authorization: "Bearer not.a.jwt" },
    "token signed with the wrong secret": {
      Authorization: `Bearer ${jwt.sign({ userId: ID, role: "ADMIN" }, "wrong-secret")}`,
    },
    "expired token": {
      Authorization: `Bearer ${jwt.sign({ userId: ID, role: "ADMIN" }, SECRET, { expiresIn: -10 })}`,
    },
    "HS384 token (algorithm not allowed)": {
      Authorization: `Bearer ${jwt.sign({ userId: ID, role: "ADMIN" }, SECRET, { algorithm: "HS384" })}`,
    },
    "unsigned alg=none token": {
      Authorization: `Bearer ${b64({ alg: "none", typ: "JWT" })}.${b64({ userId: ID, role: "ADMIN" })}.`,
    },
    "valid signature but no role claim": {
      Authorization: `Bearer ${jwt.sign({ userId: ID }, SECRET)}`,
    },
    "valid signature but unsupported role": {
      Authorization: `Bearer ${jwt.sign({ userId: ID, role: "UNKNOWN" }, SECRET)}`,
    },
    "valid signature but no userId claim": {
      Authorization: `Bearer ${jwt.sign({ role: "ADMIN" }, SECRET)}`,
    },
  };

  for (const [name, headers] of Object.entries(badAuthHeaders)) {
    test(`${name} -> 401`, async () => {
      const res = await call("GET", target, { headers });
      assert.equal(res.status, 401);
    });
  }

  test("a bad token is also rejected on a role-restricted route", async () => {
    const res = await call("POST", "/api/signal-optimization/optimize", {
      headers: badAuthHeaders["expired token"],
      body: {},
    });
    assert.equal(res.status, 401);
  });
});

// ---------------------------------------------------------------------------
// 4 + 5. Role matrix: insufficient roles get 403, permitted roles get through
// ---------------------------------------------------------------------------
describe("role-based authorization", () => {
  for (const [key, rule] of Object.entries(MATRIX)) {
    if (rule === "PUBLIC") continue;
    const allowed = rule === "AUTH" ? ROLES : rule;

    for (const role of ROLES) {
      const permitted = allowed.includes(role);
      test(`${key} as ${role} -> ${permitted ? "allowed through" : "403"}`, async () => {
        const res = await call(methodOf(key), concretePath(key), {
          token: tokenFor(role),
          body: methodOf(key) === "POST" ? {} : undefined,
        });
        if (permitted) {
          // Auth passed. The handler then fails (400/404/500, no DB or empty body).
          assert.notEqual(res.status, 401, "unexpected 401");
          assert.notEqual(res.status, 403, "unexpected 403");
        } else {
          assert.equal(res.status, 403);
          assert.equal(res.body.success, false);
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Real responses for permitted access (model methods stubbed)
// ---------------------------------------------------------------------------
describe("permitted access returns the existing response contract", () => {
  test("login returns the existing invalid-credentials response when the account is absent", async () => {
    mock.method(User, "findOne", async () => null);

    const res = await call("POST", "/api/auth/login", {
      body: { email: "missing@example.com", password: "correct-password" },
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "Invalid email or password");
    assert.equal(res.body.token, undefined);
  });

  test("CITIZEN can read traffic locations (200, {count, locations})", async () => {
    const rows = [{ _id: ID, name: "Junction A", area: "Zone 1" }];
    mock.method(TrafficLocation, "find", () => query(rows));

    const res = await call("GET", "/api/traffic-locations", { token: tokenFor("CITIZEN") });
    assert.equal(res.status, 200);
    assert.equal(res.body.count, 1);
    assert.equal(res.body.locations[0].name, "Junction A");
  });

  test("login stays public and returns a token carrying the role", async () => {
    const hash = bcrypt.hashSync("correct-password", 4);
    mock.method(User, "findOne", async () => ({
      _id: ID,
      fullName: "Pat Police",
      email: "pat@example.com",
      password: hash,
      role: "TRAFFIC_POLICE",
    }));

    const ok = await call("POST", "/api/auth/login", {
      body: { email: "pat@example.com", password: "correct-password" },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.success, true);
    const decoded = jwt.verify(ok.body.token, SECRET);
    assert.equal(decoded.role, "TRAFFIC_POLICE");
    assert.equal(decoded.userId, ID);

    const bad = await call("POST", "/api/auth/login", {
      body: { email: "pat@example.com", password: "wrong" },
    });
    assert.equal(bad.status, 401);
  });

  test("login rejects a user with an unsupported role without issuing a token", async () => {
    const hash = bcrypt.hashSync("correct-password", 4);
    mock.method(User, "findOne", async () => ({
      _id: ID,
      fullName: "Unknown Role",
      email: "unknown@example.com",
      password: hash,
      role: "UNKNOWN",
    }));

    const res = await call("POST", "/api/auth/login", {
      body: { email: "unknown@example.com", password: "correct-password" },
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "Invalid email or password");
    assert.equal(res.body.token, undefined);
  });
});

// ---------------------------------------------------------------------------
// 6. Public registration cannot escalate privileges
// ---------------------------------------------------------------------------
describe("registration privilege escalation", () => {
  function stubUserCreation() {
    const created = [];
    mock.method(User, "findOne", async () => null);
    mock.method(User, "create", async (doc) => {
      created.push(doc);
      return { _id: ID, ...doc };
    });
    return created;
  }

  const person = { fullName: "New Person", email: "new@example.com", password: "pw12345678" };

  for (const role of ["ADMIN", "TRAFFIC_AUTHORITY", "TRAFFIC_POLICE", "EMERGENCY_SERVICE", "admin", "SUPERUSER"]) {
    test(`public register with role ${role} -> 403 and nothing is created`, async () => {
      const created = stubUserCreation();
      const res = await call("POST", "/api/auth/register", { body: { ...person, role } });
      assert.equal(res.status, 403);
      assert.equal(created.length, 0);
    });
  }

  test("public register with no role creates a CITIZEN", async () => {
    const created = stubUserCreation();
    const res = await call("POST", "/api/auth/register", { body: person });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, "CITIZEN");
    assert.equal(created[0].role, "CITIZEN");
    assert.notEqual(created[0].password, person.password, "password must be hashed");
  });

  test("public register with role CITIZEN (existing clients) still works", async () => {
    const created = stubUserCreation();
    const res = await call("POST", "/api/auth/register", { body: { ...person, role: "CITIZEN" } });
    assert.equal(res.status, 201);
    assert.equal(created[0].role, "CITIZEN");
  });

  test("a logged-in non-admin cannot use register to pick a role either", async () => {
    const created = stubUserCreation();
    const res = await call("POST", "/api/auth/register", {
      token: tokenFor("TRAFFIC_AUTHORITY"),
      body: { ...person, role: "ADMIN" },
    });
    assert.equal(res.status, 403);
    assert.equal(created.length, 0);
  });

  test("POST /api/auth/users provisions a staff account for ADMIN only", async () => {
    const created = stubUserCreation();

    const asAdmin = await call("POST", "/api/auth/users", {
      token: tokenFor("ADMIN"),
      body: { ...person, role: "TRAFFIC_POLICE" },
    });
    assert.equal(asAdmin.status, 201);
    assert.equal(created.at(-1).role, "TRAFFIC_POLICE");

    const before = created.length;
    for (const role of ["TRAFFIC_AUTHORITY", "TRAFFIC_POLICE", "EMERGENCY_SERVICE", "CITIZEN"]) {
      const res = await call("POST", "/api/auth/users", {
        token: tokenFor(role),
        body: { ...person, role: "ADMIN" },
      });
      assert.equal(res.status, 403, role);
    }
    assert.equal(created.length, before, "non-admin calls must not create users");
  });

  test("POST /api/auth/users rejects a missing or invalid role with 400", async () => {
    stubUserCreation();
    for (const role of [undefined, "", "SUPERUSER"]) {
      const res = await call("POST", "/api/auth/users", {
        token: tokenFor("ADMIN"),
        body: { ...person, role },
      });
      assert.equal(res.status, 400, String(role));
    }
  });
});

// ---------------------------------------------------------------------------
// Citizen reports: ownership and workflow-field protection
// ---------------------------------------------------------------------------
describe("citizen report ownership", () => {
  const report = { location: ID, reportType: "ACCIDENT", description: "Collision at junction" };

  function captureSave() {
    const saved = [];
    mock.method(CitizenReport.prototype, "save", async function () {
      saved.push(this);
      return this;
    });
    return saved;
  }

  test("reportedBy is taken from the token when omitted", async () => {
    const saved = captureSave();
    const res = await call("POST", "/api/citizen-reports", { token: tokenFor("CITIZEN", ID), body: report });
    assert.equal(res.status, 201);
    assert.equal(String(saved[0].reportedBy), ID);
  });

  test("missing request body returns 400 without saving a report", async () => {
    const saved = captureSave();
    const res = await call("POST", "/api/citizen-reports", {
      token: tokenFor("CITIZEN", ID),
    });

    assert.equal(res.status, 400);
    assert.equal(
      res.body.message,
      "location, reportType, and description are required"
    );
    assert.equal(saved.length, 0);
  });

  test("invalid report fields return 400 without saving a report", async () => {
    const saved = captureSave();
    const invalidReports = [
      { ...report, location: "not-a-location-id" },
      { ...report, reportType: "UNSUPPORTED" },
      { ...report, description: "   " },
      { ...report, severity: "CRITICAL" },
    ];

    for (const invalidReport of invalidReports) {
      const res = await call("POST", "/api/citizen-reports", {
        token: tokenFor("CITIZEN", ID),
        body: invalidReport,
      });
      assert.equal(res.status, 400);
    }

    assert.equal(saved.length, 0);
  });

  test("a citizen cannot file a report as another user -> 403", async () => {
    const saved = captureSave();
    const res = await call("POST", "/api/citizen-reports", {
      token: tokenFor("CITIZEN", ID),
      body: { ...report, reportedBy: OTHER_ID },
    });
    assert.equal(res.status, 403);
    assert.equal(saved.length, 0);
  });

  test("a citizen cannot pre-set status or review fields", async () => {
    const saved = captureSave();
    const res = await call("POST", "/api/citizen-reports", {
      token: tokenFor("CITIZEN", ID),
      body: { ...report, status: "VERIFIED", reviewedBy: OTHER_ID, reviewedAt: new Date().toISOString() },
    });
    assert.equal(res.status, 201);
    assert.equal(saved[0].status, "SUBMITTED");
    assert.equal(saved[0].reviewedBy, undefined);
    assert.equal(saved[0].reviewedAt, undefined);
  });

  test("review-only fields are ignored during report creation for all roles", async () => {
    const saved = captureSave();
    const res = await call("POST", "/api/citizen-reports", {
      token: tokenFor("TRAFFIC_POLICE", ID),
      body: {
        ...report,
        status: "VERIFIED",
        reviewedBy: OTHER_ID,
        reviewedAt: new Date().toISOString(),
      },
    });
    assert.equal(res.status, 201);
    assert.equal(saved[0].status, "SUBMITTED");
    assert.equal(saved[0].reviewedBy, undefined);
    assert.equal(saved[0].reviewedAt, undefined);
  });

  test("list: citizens see only their reports; staff roles see all reports", async () => {
    const filters = [];
    const countFilters = [];
    mock.method(CitizenReport, "find", (filter) => {
      filters.push(filter);
      return query([
        { _id: ID, status: "SUBMITTED" },
        { _id: OTHER_ID, status: "UNDER_REVIEW" },
      ]);
    });
    mock.method(CitizenReport, "countDocuments", async (filter) => {
      countFilters.push(filter);
      return 2;
    });

    const citizen = await call("GET", "/api/citizen-reports", {
      token: tokenFor("CITIZEN", ID),
    });
    const emergency = await call("GET", "/api/citizen-reports", {
      token: tokenFor("EMERGENCY_SERVICE", ID),
    });
    const police = await call("GET", "/api/citizen-reports", {
      token: tokenFor("TRAFFIC_POLICE", ID),
    });
    const admin = await call("GET", "/api/citizen-reports", {
      token: tokenFor("ADMIN", ID),
    });
    const authority = await call("GET", "/api/citizen-reports", {
      token: tokenFor("TRAFFIC_AUTHORITY", ID),
    });

    assert.deepEqual(filters[0], { reportedBy: ID });
    assert.deepEqual(filters.slice(1), [{}, {}, {}, {}]);
    assert.deepEqual(countFilters, filters, "the total is scoped exactly like the page");
    assert.equal(emergency.status, 200);
    assert.equal(emergency.body.count, 2);
    assert.deepEqual(emergency.body.pagination, { page: 1, limit: 50, total: 2, totalPages: 1 });
    assert.deepEqual(
      emergency.body.reports.map((item) => item.status),
      ["SUBMITTED", "UNDER_REVIEW"]
    );
    for (const response of [citizen, police, admin, authority]) {
      assert.equal(response.status, 200);
    }
  });

  test("get by ID: citizens are owner-scoped; Emergency Service and reviewers can view any report", async () => {
    const theirs = { _id: OTHER_ID, reportedBy: { _id: OTHER_ID, fullName: "Someone" } };
    const mine = { _id: ID, reportedBy: { _id: ID, fullName: "Me" } };
    mock.method(CitizenReport, "findById", (id) => query(id === ID ? mine : theirs));

    const own = await call("GET", `/api/citizen-reports/${ID}`, { token: tokenFor("CITIZEN", ID) });
    assert.equal(own.status, 200);
    assert.equal(Object.hasOwn(own.body, "reportedBy"), false);
    assert.equal(Object.hasOwn(own.body, "reviewedBy"), false);
    assert.equal(Object.hasOwn(own.body, "reviewedAt"), false);

    const other = await call("GET", `/api/citizen-reports/${OTHER_ID}`, { token: tokenFor("CITIZEN", ID) });
    assert.equal(other.status, 404);

    const reviewer = await call("GET", `/api/citizen-reports/${OTHER_ID}`, { token: tokenFor("TRAFFIC_AUTHORITY", ID) });
    assert.equal(reviewer.status, 200);

    const emergency = await call("GET", `/api/citizen-reports/${OTHER_ID}`, {
      token: tokenFor("EMERGENCY_SERVICE", ID),
    });
    assert.equal(emergency.status, 200);
    assert.equal(Object.hasOwn(emergency.body, "reportedBy"), false);
  });
});

describe("citizen report review updates", () => {
  function mockReport(status = "SUBMITTED") {
    const saved = [];
    const report = {
      _id: ID,
      status,
      save: async function () {
        this.updatedAt = new Date();
        saved.push(this);
        return this;
      },
    };
    mock.method(CitizenReport, "findById", (id) =>
      Promise.resolve(id === ID ? report : null)
    );
    return { report, saved };
  }

  test("each authorized reviewer updates status with server-set identity and timestamps", async () => {
    const { report, saved } = mockReport();
    for (const role of ["ADMIN", "TRAFFIC_AUTHORITY", "TRAFFIC_POLICE"]) {
      report.status = "SUBMITTED";
      const reviewerId = role === "ADMIN" ? OTHER_ID : ID;
      const response = await call(
        "PATCH",
        `/api/citizen-reports/${ID}/review`,
        {
          token: tokenFor(role, reviewerId),
          body: { status: "UNDER_REVIEW" },
        }
      );
      assert.equal(response.status, 200, role);
      assert.equal(response.body.report.status, "UNDER_REVIEW", role);
      assert.equal(String(response.body.report.reviewedBy), reviewerId, role);
      assert.ok(response.body.report.reviewedAt, role);
      assert.ok(response.body.report.updatedAt, role);
    }
    assert.equal(saved.length, 3);
  });

  test("reviewers can follow every allowed status transition", async () => {
    const { report } = mockReport();
    const transitions = [
      ["SUBMITTED", "UNDER_REVIEW"],
      ["UNDER_REVIEW", "VERIFIED"],
      ["UNDER_REVIEW", "RESOLVED"],
      ["UNDER_REVIEW", "REJECTED"],
      ["VERIFIED", "RESOLVED"],
      ["VERIFIED", "REJECTED"],
    ];

    for (const [index, [currentStatus, nextStatus]] of transitions.entries()) {
      report.status = currentStatus;
      const role = ["ADMIN", "TRAFFIC_AUTHORITY", "TRAFFIC_POLICE"][index % 3];
      const response = await call(
        "PATCH",
        `/api/citizen-reports/${ID}/review`,
        { token: tokenFor(role), body: { status: nextStatus } }
      );
      assert.equal(response.status, 200, `${currentStatus} -> ${nextStatus}`);
      assert.equal(response.body.report.status, nextStatus);
    }
  });

  test("Emergency Service can read reports but cannot update review status", async () => {
    const response = await call(
      "PATCH",
      `/api/citizen-reports/${ID}/review`,
      {
        token: tokenFor("EMERGENCY_SERVICE"),
        body: { status: "UNDER_REVIEW" },
      }
    );
    assert.equal(response.status, 403);
  });

  test("Citizens cannot update review status or spoof review fields", async () => {
    const { saved } = mockReport();
    const response = await call(
      "PATCH",
      `/api/citizen-reports/${ID}/review`,
      {
        token: tokenFor("CITIZEN"),
        body: {
          status: "UNDER_REVIEW",
          reviewedBy: OTHER_ID,
          reviewedAt: new Date().toISOString(),
        },
      }
    );
    assert.equal(response.status, 403);
    assert.equal(saved.length, 0);
  });

  test("invalid IDs, missing reports, missing or invalid statuses are rejected", async () => {
    const { saved } = mockReport();
    const invalidId = await call("PATCH", "/api/citizen-reports/not-an-id/review", {
      token: tokenFor("ADMIN"),
      body: { status: "UNDER_REVIEW" },
    });
    assert.equal(invalidId.status, 400);

    const missing = await call(
      "PATCH",
      `/api/citizen-reports/${OTHER_ID}/review`,
      { token: tokenFor("ADMIN"), body: { status: "UNDER_REVIEW" } }
    );
    assert.equal(missing.status, 404);

    const missingStatus = await call(
      "PATCH",
      `/api/citizen-reports/${ID}/review`,
      { token: tokenFor("ADMIN"), body: {} }
    );
    assert.equal(missingStatus.status, 400);

    const invalidStatus = await call(
      "PATCH",
      `/api/citizen-reports/${ID}/review`,
      { token: tokenFor("ADMIN"), body: { status: "OPEN" } }
    );
    assert.equal(invalidStatus.status, 400);
    assert.equal(saved.length, 0);
  });

  test("review updates reject unsupported fields and invalid transitions", async () => {
    const { report, saved } = mockReport();
    const spoofed = await call(
      "PATCH",
      `/api/citizen-reports/${ID}/review`,
      {
        token: tokenFor("ADMIN"),
        body: { status: "UNDER_REVIEW", reviewedBy: OTHER_ID },
      }
    );
    assert.equal(spoofed.status, 400);

    const invalidTransition = await call(
      "PATCH",
      `/api/citizen-reports/${ID}/review`,
      { token: tokenFor("ADMIN"), body: { status: "RESOLVED" } }
    );
    assert.equal(invalidTransition.status, 409);
    assert.equal(report.status, "SUBMITTED");
    assert.equal(saved.length, 0);
  });
});
