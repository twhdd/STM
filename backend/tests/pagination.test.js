// Pagination and bounded-read tests. Run: npm test (from backend/)
// No database needed: model methods are stubbed, requests go through the real Express app.
process.env.JWT_SECRET = "test-secret-for-pagination-tests";

const { test, describe, before, after, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

mongoose.set("bufferCommands", false);

const app = require("../server");
const TrafficMeasurement = require("../models/TrafficMeasurement");
const CongestionEvent = require("../models/CongestionEvent");
const TrafficAlert = require("../models/TrafficAlert");
const CitizenReport = require("../models/CitizenReport");

const oid = () => new mongoose.Types.ObjectId();

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

async function get(path, { role = "TRAFFIC_AUTHORITY", userId = oid().toString() } = {}) {
  const token = jwt.sign({ userId, role }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const res = await fetch(baseUrl + path, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: json, text };
}

// A thenable stand-in for a Mongoose query that records how it was bounded.
function chain(result, seen) {
  const q = {
    sort: (value) => {
      seen.sort = value;
      return q;
    },
    skip: (value) => {
      seen.skip = value;
      return q;
    },
    limit: (value) => {
      seen.limit = value;
      return q;
    },
    populate: () => q,
    select: () => q,
    lean: () => q,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return q;
}

function stubList(Model, items, total) {
  const seen = { finds: 0, counts: 0 };
  mock.method(Model, "find", (filter) => {
    seen.finds += 1;
    seen.findFilter = filter;
    return chain(items, seen);
  });
  mock.method(Model, "countDocuments", async (filter) => {
    seen.counts += 1;
    seen.countFilter = filter;
    return total;
  });
  return seen;
}

const makeItems = (n) => Array.from({ length: n }, (_, i) => ({ _id: oid(), n: i }));

describe("pagination helper", () => {
  test("applies defaults and computes skip", () => {
    const { parsePagination, DEFAULT_LIMIT } = require("../utils/pagination");
    assert.deepEqual(parsePagination({}), { page: 1, limit: DEFAULT_LIMIT, skip: 0 });
    assert.deepEqual(parsePagination({ page: "3", limit: "10" }), { page: 3, limit: 10, skip: 20 });
  });

  test("rejects malformed, non-integer, non-positive and oversized values", () => {
    const { parsePagination, MAX_LIMIT } = require("../utils/pagination");
    for (const query of [
      { page: "0" },
      { page: "-1" },
      { page: "1.5" },
      { page: "abc" },
      { page: "" },
      { page: "1e2" },
      { page: "01" },
      { page: ["1", "2"] },
      { limit: "0" },
      { limit: "-5" },
      { limit: "2.5" },
      { limit: String(MAX_LIMIT + 1) },
      { limit: "99999999999999999999" },
    ]) {
      assert.throws(() => parsePagination(query), { code: "INVALID_PAGINATION", statusCode: 400 }, JSON.stringify(query));
    }
  });

  test("builds metadata with zero pages for an empty result", () => {
    const { buildPagination } = require("../utils/pagination");
    assert.deepEqual(buildPagination({ page: 1, limit: 50 }, 0), { page: 1, limit: 50, total: 0, totalPages: 0 });
    assert.deepEqual(buildPagination({ page: 2, limit: 10 }, 21), { page: 2, limit: 10, total: 21, totalPages: 3 });
  });
});

const LISTS = [
  { name: "traffic measurements", path: "/api/traffic-measurements", Model: TrafficMeasurement, key: "measurements", sort: { measuredAt: -1, _id: -1 } },
  { name: "congestion events", path: "/api/congestion-events", Model: CongestionEvent, key: "events", sort: { detectedAt: -1, _id: -1 } },
  { name: "traffic alerts", path: "/api/traffic-alerts", Model: TrafficAlert, key: "alerts", sort: { createdAt: -1, _id: -1 } },
  { name: "citizen reports", path: "/api/citizen-reports", Model: CitizenReport, key: "reports", sort: { createdAt: -1, _id: -1 } },
];

for (const list of LISTS) {
  describe(`GET ${list.path}`, () => {
    test("applies the default page and limit, sorts deterministically and returns metadata", async () => {
      const seen = stubList(list.Model, makeItems(3), 3);

      const res = await get(list.path);

      assert.equal(res.status, 200, res.text);
      assert.equal(res.body[list.key].length, 3);
      assert.equal(res.body.count, 3);
      assert.deepEqual(res.body.pagination, { page: 1, limit: 50, total: 3, totalPages: 1 });
      assert.equal(seen.skip, 0);
      assert.equal(seen.limit, 50);
      assert.deepEqual(seen.sort, list.sort);
    });

    test("translates page and limit into skip and limit", async () => {
      const seen = stubList(list.Model, makeItems(10), 45);

      const res = await get(`${list.path}?page=3&limit=10`);

      assert.equal(res.status, 200, res.text);
      assert.equal(seen.skip, 20);
      assert.equal(seen.limit, 10);
      assert.deepEqual(res.body.pagination, { page: 3, limit: 10, total: 45, totalPages: 5 });
    });

    test("returns an empty page with zero totals when there is no data", async () => {
      stubList(list.Model, [], 0);

      const res = await get(list.path);

      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.body[list.key], []);
      assert.equal(res.body.count, 0);
      assert.deepEqual(res.body.pagination, { page: 1, limit: 50, total: 0, totalPages: 0 });
    });

    test("a page beyond the last one is an empty page, not an error", async () => {
      stubList(list.Model, [], 45);

      const res = await get(`${list.path}?page=9&limit=10`);

      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.body[list.key], []);
      assert.deepEqual(res.body.pagination, { page: 9, limit: 10, total: 45, totalPages: 5 });
    });

    test("accepts the maximum limit and rejects anything above it", async () => {
      const seen = stubList(list.Model, [], 0);

      const ok = await get(`${list.path}?limit=100`);
      assert.equal(ok.status, 200, ok.text);
      assert.equal(seen.limit, 100);

      const tooBig = await get(`${list.path}?limit=101`);
      assert.equal(tooBig.status, 400);
      assert.equal(tooBig.body.code, "INVALID_PAGINATION");
    });

    test("rejects invalid pagination with 400 before touching the database", async () => {
      const seen = stubList(list.Model, [], 0);

      for (const query of [
        "page=0",
        "page=-1",
        "page=1.5",
        "page=abc",
        "page=",
        "limit=0",
        "limit=-5",
        "limit=2.5",
        "page=1&page=2",
        "limit=99999999999999999999",
      ]) {
        const res = await get(`${list.path}?${query}`);
        assert.equal(res.status, 400, query);
        assert.equal(res.body.code, "INVALID_PAGINATION", query);
      }
      assert.equal(seen.finds + seen.counts, 0, "no query may run for invalid input");
    });
  });
}

describe("list filters", () => {
  for (const [name, path, Model] of [
    ["congestion events", "/api/congestion-events", CongestionEvent],
    ["traffic alerts", "/api/traffic-alerts", TrafficAlert],
  ]) {
    test(`${name}: status filter is applied to both the page and the total`, async () => {
      const seen = stubList(Model, makeItems(2), 11);

      const res = await get(`${path}?status=ACTIVE&limit=5`);

      assert.equal(res.status, 200, res.text);
      assert.deepEqual(seen.findFilter, { status: "ACTIVE" });
      assert.deepEqual(seen.countFilter, { status: "ACTIVE" });
      assert.equal(res.body.pagination.total, 11);
    });

    test(`${name}: an unknown status is rejected with 400 and no query runs`, async () => {
      const seen = stubList(Model, [], 0);

      const res = await get(`${path}?status=BOGUS`);

      assert.equal(res.status, 400);
      assert.equal(res.body.code, "INVALID_FILTER");
      assert.equal(seen.finds + seen.counts, 0);
    });
  }

  test("traffic measurements: location filter is applied to both the page and the total", async () => {
    const location = oid().toString();
    const seen = stubList(TrafficMeasurement, makeItems(2), 7);

    const res = await get(`/api/traffic-measurements?location=${location}`);

    assert.equal(res.status, 200, res.text);
    assert.deepEqual(seen.findFilter, { location });
    assert.deepEqual(seen.countFilter, { location });
    assert.equal(res.body.pagination.total, 7);
  });

  test("traffic measurements: an invalid location is rejected with 400 and no query runs", async () => {
    const seen = stubList(TrafficMeasurement, [], 0);

    const res = await get("/api/traffic-measurements?location=not-an-id");

    assert.equal(res.status, 400);
    assert.equal(res.body.code, "INVALID_FILTER");
    assert.equal(seen.finds + seen.counts, 0);
  });
});

describe("citizen report visibility is preserved under pagination", () => {
  test("a citizen is paged and counted over their own reports only", async () => {
    const userId = oid().toString();
    const seen = stubList(CitizenReport, makeItems(2), 2);

    const res = await get("/api/citizen-reports?limit=5", { role: "CITIZEN", userId });

    assert.equal(res.status, 200, res.text);
    assert.deepEqual(seen.findFilter, { reportedBy: userId });
    assert.deepEqual(seen.countFilter, { reportedBy: userId });
    assert.equal(res.body.pagination.total, 2);
  });

  test("reviewers and emergency service are paged over all reports", async () => {
    for (const role of ["ADMIN", "TRAFFIC_AUTHORITY", "TRAFFIC_POLICE", "EMERGENCY_SERVICE"]) {
      const seen = stubList(CitizenReport, makeItems(1), 9);

      const res = await get("/api/citizen-reports", { role });

      assert.equal(res.status, 200, `${role}: ${res.text}`);
      assert.deepEqual(seen.findFilter, {}, role);
      assert.deepEqual(seen.countFilter, {}, role);
      assert.equal(res.body.pagination.total, 9, role);
      mock.restoreAll();
    }
  });
});

describe("GET /api/traffic-analytics is a bounded aggregation", () => {
  function stubAnalytics({ totals, distribution, events = 192, activeAlerts = 11 }) {
    const calls = { find: 0, aggregate: 0 };
    mock.method(TrafficMeasurement, "find", () => {
      calls.find += 1;
      throw new Error("analytics must not load every measurement");
    });
    mock.method(CongestionEvent, "find", () => {
      calls.find += 1;
      throw new Error("analytics must not load every event");
    });
    mock.method(TrafficMeasurement, "aggregate", async (pipeline) => {
      calls.aggregate += 1;
      return pipeline[0].$group._id === null ? totals : distribution;
    });
    mock.method(CongestionEvent, "countDocuments", async () => events);
    mock.method(TrafficAlert, "countDocuments", async (filter) => {
      assert.deepEqual(filter, { status: "ACTIVE" });
      return activeAlerts;
    });
    return calls;
  }

  test("returns the same figures without loading every document", async () => {
    const calls = stubAnalytics({
      totals: [{ _id: null, total: 4, totalVehicles: 400, totalSpeed: 120 }],
      distribution: [
        { _id: "LOW", n: 1 },
        { _id: "MEDIUM", n: 1 },
        { _id: "HIGH", n: 1 },
        { _id: "SEVERE", n: 1 },
      ],
    });

    const res = await get("/api/traffic-analytics");

    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body.analytics, {
      totalMeasurements: 4,
      averageVehicleCount: 100,
      averageSpeed: 30,
      trafficDistribution: { LOW: 1, MEDIUM: 1, HIGH: 1, SEVERE: 1 },
      totalCongestionEvents: 192,
      activeAlerts: 11,
    });
    assert.equal(calls.find, 0);
    assert.ok(calls.aggregate >= 1);
  });

  test("rounds averages to two decimals and zero-fills missing density classes", async () => {
    stubAnalytics({
      totals: [{ _id: null, total: 3, totalVehicles: 10, totalSpeed: 100 }],
      distribution: [{ _id: "HIGH", n: 3 }],
    });

    const res = await get("/api/traffic-analytics");

    assert.equal(res.body.analytics.averageVehicleCount, 3.33);
    assert.equal(res.body.analytics.averageSpeed, 33.33);
    assert.deepEqual(res.body.analytics.trafficDistribution, { LOW: 0, MEDIUM: 0, HIGH: 3, SEVERE: 0 });
  });

  test("keeps the empty-data shape", async () => {
    const calls = stubAnalytics({ totals: [], distribution: [], events: 5, activeAlerts: 2 });

    const res = await get("/api/traffic-analytics");

    assert.deepEqual(res.body.analytics, {
      totalMeasurements: 0,
      averageVehicleCount: 0,
      averageSpeed: 0,
      trafficDistribution: {},
      totalCongestionEvents: 5,
      activeAlerts: 2,
    });
    assert.equal(calls.find, 0);
  });
});
