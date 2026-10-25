// PATCH /api/routes/:id/waypoints tests. Run: npm test (from backend/)
// No database needed: model methods are stubbed, requests go through the real Express app.
// Nothing here writes to a real database.
process.env.JWT_SECRET = "test-secret-for-route-waypoint-tests";

const { test, describe, before, after, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

mongoose.set("bufferCommands", false);

const app = require("../server");
const Route = require("../models/Route");
const TrafficLocation = require("../models/TrafficLocation");

const oid = () => new mongoose.Types.ObjectId();
const ROUTE_ID = oid().toString();
const [L1, L2, L3] = [oid().toString(), oid().toString(), oid().toString()];

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

async function patch(routeId, body, { role = "TRAFFIC_AUTHORITY", raw } = {}) {
  const token = jwt.sign({ userId: oid().toString(), role }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
  const res = await fetch(`${baseUrl}/api/routes/${routeId}/waypoints`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: json, text };
}

// A thenable stand-in for a Mongoose query.
function chain(result) {
  const q = {
    select: () => q,
    populate: () => q,
    lean: () => q,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return q;
}

// Stubs both models and records every call so tests can prove nothing was written.
function stubModels({ existingLocations = [L1, L2, L3], updatedRoute } = {}) {
  const calls = { locationFinds: [], routeWrites: [] };
  mock.method(TrafficLocation, "find", (filter) => {
    calls.locationFinds.push(filter);
    const requested = (filter?._id?.$in || []).map(String);
    return chain(
      requested
        .filter((id) => existingLocations.includes(id))
        .map((id) => ({ _id: new mongoose.Types.ObjectId(id) }))
    );
  });
  mock.method(Route, "findOneAndUpdate", (filter, update, options) => {
    calls.routeWrites.push({ filter, update, options });
    return chain(updatedRoute === undefined ? { _id: ROUTE_ID, waypoints: update.$set?.waypoints } : updatedRoute);
  });
  return calls;
}

const untouched = (calls) => calls.locationFinds.length === 0 && calls.routeWrites.length === 0;

describe("authorization", () => {
  test("ADMIN and TRAFFIC_AUTHORITY may update waypoints", async () => {
    for (const role of ["ADMIN", "TRAFFIC_AUTHORITY"]) {
      stubModels();
      const res = await patch(ROUTE_ID, { waypoints: [L1] }, { role });
      assert.equal(res.status, 200, `${role}: ${res.text}`);
      mock.restoreAll();
    }
  });

  test("every other role is forbidden and nothing is read or written", async () => {
    for (const role of ["TRAFFIC_POLICE", "EMERGENCY_SERVICE", "CITIZEN"]) {
      const calls = stubModels();
      const res = await patch(ROUTE_ID, { waypoints: [L1] }, { role });
      assert.equal(res.status, 403, role);
      assert.ok(untouched(calls), role);
      mock.restoreAll();
    }
  });

  test("an unauthenticated request is rejected with 401", async () => {
    const calls = stubModels();
    const res = await fetch(`${baseUrl}/api/routes/${ROUTE_ID}/waypoints`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waypoints: [L1] }),
    });
    assert.equal(res.status, 401);
    assert.ok(untouched(calls));
  });
});

describe("route id and body validation (no query runs, nothing is written)", () => {
  test("a malformed route id is a 400 INVALID_ID", async () => {
    for (const id of ["not-an-id", "123", "507f1f77bcf86cd79943901", "zzzzzzzzzzzzzzzzzzzzzzzz"]) {
      const calls = stubModels();
      const res = await patch(id, { waypoints: [L1] });
      assert.equal(res.status, 400, id);
      assert.equal(res.body.code, "INVALID_ID", id);
      assert.ok(untouched(calls), id);
      mock.restoreAll();
    }
  });

  test("waypoints must be explicitly supplied as an array", async () => {
    const bodies = [
      undefined,
      {},
      { waypoints: null },
      { waypoints: "abc" },
      { waypoints: L1 },
      { waypoints: 5 },
      { waypoints: {} },
      { waypoints: { 0: L1 } },
      [L1],
    ];
    for (const body of bodies) {
      const calls = stubModels();
      const res = await patch(ROUTE_ID, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.code, "INVALID_WAYPOINTS", JSON.stringify(body));
      assert.ok(untouched(calls), JSON.stringify(body));
      mock.restoreAll();
    }
  });

  test("a body that is not valid JSON is a 400", async () => {
    const calls = stubModels();
    const res = await patch(ROUTE_ID, undefined, { raw: "{not json" });
    assert.equal(res.status, 400);
    assert.ok(untouched(calls));
  });

  test("any field other than waypoints is rejected so no other route field can change", async () => {
    for (const extra of [{ distance: 1 }, { estimatedTime: 1 }, { trafficLevel: "LOW" }, { startLocation: L1 }, { status: "BLOCKED" }]) {
      const calls = stubModels();
      const res = await patch(ROUTE_ID, { waypoints: [L1], ...extra });
      assert.equal(res.status, 400, JSON.stringify(extra));
      assert.equal(res.body.code, "UNEXPECTED_FIELDS", JSON.stringify(extra));
      assert.deepEqual(res.body.fields, Object.keys(extra));
      assert.ok(untouched(calls), JSON.stringify(extra));
      mock.restoreAll();
    }
  });

  test("malformed waypoint ids are rejected with the offending index", async () => {
    const cases = [
      [["not-an-id"], 0],
      [[L1, 123], 1],
      [[L1, L2, null], 2],
      [[{}], 0],
      [[""], 0],
      [["507f1f77bcf86cd79943901"], 0],
      [[L1, [L2]], 1],
    ];
    for (const [waypoints, index] of cases) {
      const calls = stubModels();
      const res = await patch(ROUTE_ID, { waypoints });
      assert.equal(res.status, 400, JSON.stringify(waypoints));
      assert.equal(res.body.code, "INVALID_WAYPOINT_ID", JSON.stringify(waypoints));
      assert.equal(res.body.index, index, JSON.stringify(waypoints));
      assert.ok(untouched(calls), JSON.stringify(waypoints));
      mock.restoreAll();
    }
  });

  test("duplicates are rejected, including the same id in a different letter case", async () => {
    for (const waypoints of [[L1, L2, L1], [L1, L1], [L1, L1.toUpperCase()]]) {
      const calls = stubModels();
      const res = await patch(ROUTE_ID, { waypoints });
      assert.equal(res.status, 400, JSON.stringify(waypoints));
      assert.equal(res.body.code, "DUPLICATE_WAYPOINTS", JSON.stringify(waypoints));
      assert.ok(untouched(calls), JSON.stringify(waypoints));
      mock.restoreAll();
    }
  });

  test("more than 25 waypoints is rejected before any query, exactly 25 is accepted", async () => {
    const many = (n) => Array.from({ length: n }, () => oid().toString());

    const tooMany = stubModels();
    const rejected = await patch(ROUTE_ID, { waypoints: many(26) });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.code, "TOO_MANY_WAYPOINTS");
    assert.equal(rejected.body.max, 25);
    assert.ok(untouched(tooMany));
    mock.restoreAll();

    const ids = many(25);
    stubModels({ existingLocations: ids });
    const accepted = await patch(ROUTE_ID, { waypoints: ids });
    assert.equal(accepted.status, 200, accepted.text);
  });
});

describe("location existence", () => {
  test("an unknown location is rejected, naming every missing id, and the route is not written", async () => {
    const ghostA = oid().toString();
    const ghostB = oid().toString();
    const calls = stubModels();

    const res = await patch(ROUTE_ID, { waypoints: [L1, ghostA, L2, ghostB] });

    assert.equal(res.status, 400);
    assert.equal(res.body.code, "UNKNOWN_LOCATION");
    assert.deepEqual(res.body.missing, [ghostA, ghostB]);
    assert.equal(calls.locationFinds.length, 1);
    assert.equal(calls.routeWrites.length, 0);
  });

  test("existence is checked with one query over the submitted ids", async () => {
    const calls = stubModels();

    await patch(ROUTE_ID, { waypoints: [L2, L1] });

    assert.equal(calls.locationFinds.length, 1);
    assert.deepEqual(calls.locationFinds[0]._id.$in, [L2, L1]);
  });
});

describe("a valid update", () => {
  test("sets only waypoints, in exactly the submitted order, with validators on", async () => {
    const calls = stubModels();

    const res = await patch(ROUTE_ID, { waypoints: [L3, L1, L2] });

    assert.equal(res.status, 200, res.text);
    assert.equal(calls.routeWrites.length, 1);
    const [{ filter, update, options }] = calls.routeWrites;
    assert.deepEqual(filter, { _id: ROUTE_ID });
    assert.deepEqual(update, { $set: { waypoints: [L3, L1, L2] } });
    assert.deepEqual(Object.keys(update), ["$set"]);
    assert.deepEqual(Object.keys(update.$set), ["waypoints"]);
    assert.equal(options.new, true);
    assert.equal(options.runValidators, true);
  });

  test("ids are normalised to lower case but never reordered or generated", async () => {
    const calls = stubModels();

    await patch(ROUTE_ID, { waypoints: [L2.toUpperCase(), L1] });

    assert.deepEqual(calls.routeWrites[0].update.$set.waypoints, [L2, L1]);
  });

  test("returns the updated route with the existing create-route response convention", async () => {
    const updatedRoute = {
      _id: ROUTE_ID,
      routeId: "R-1",
      name: "Route",
      distance: 5,
      estimatedTime: 10,
      trafficLevel: "LOW",
      waypoints: [{ _id: L1, name: "A" }],
    };
    stubModels({ updatedRoute });

    const res = await patch(ROUTE_ID, { waypoints: [L1] });

    assert.equal(res.status, 200);
    assert.equal(res.body.message, "Route waypoints updated successfully");
    assert.deepEqual(res.body.route, updatedRoute);
  });

  test("an empty array clears the waypoints by unsetting the field, without a location query", async () => {
    const calls = stubModels({ updatedRoute: { _id: ROUTE_ID, routeId: "R-1" } });

    const res = await patch(ROUTE_ID, { waypoints: [] });

    assert.equal(res.status, 200, res.text);
    assert.equal(calls.locationFinds.length, 0);
    assert.deepEqual(calls.routeWrites[0].update, { $unset: { waypoints: 1 } });
    assert.equal("waypoints" in res.body.route, false);
  });

  test("an unknown route is a 404 and nothing else is written", async () => {
    const calls = stubModels({ updatedRoute: null });

    const res = await patch(ROUTE_ID, { waypoints: [L1] });

    assert.equal(res.status, 404);
    assert.equal(res.body.code, "ROUTE_NOT_FOUND");
    assert.equal(calls.routeWrites.length, 1, "the guarded update was attempted once and matched nothing");
  });
});

describe("failures", () => {
  test("a database error is a generic 500 without internal details", async () => {
    mock.method(console, "error", () => {});
    mock.method(TrafficLocation, "find", () => {
      throw new Error("connection string mongodb://user:hunter2@host failed");
    });

    const res = await patch(ROUTE_ID, { waypoints: [L1] });

    assert.equal(res.status, 500);
    assert.equal(res.body.code, "INTERNAL_ERROR");
    assert.ok(!res.text.includes("hunter2"));
  });

  test("a write error is a generic 500 too", async () => {
    mock.method(console, "error", () => {});
    mock.method(TrafficLocation, "find", () => chain([{ _id: new mongoose.Types.ObjectId(L1) }]));
    mock.method(Route, "findOneAndUpdate", () => {
      throw new Error("write failed secret detail");
    });

    const res = await patch(ROUTE_ID, { waypoints: [L1] });

    assert.equal(res.status, 500);
    assert.ok(!res.text.includes("secret detail"));
  });
});

describe("existing route endpoints are unchanged", () => {
  test("GET /api/routes still answers for any authenticated role", async () => {
    mock.method(Route, "find", () => chain([{ routeId: "R-1" }]));
    const token = jwt.sign({ userId: oid().toString(), role: "CITIZEN" }, process.env.JWT_SECRET, { expiresIn: "1h" });

    const res = await fetch(`${baseUrl}/api/routes`, { headers: { Authorization: `Bearer ${token}` } });

    assert.equal(res.status, 200);
    assert.equal((await res.json()).count, 1);
  });
});
