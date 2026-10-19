const { afterEach, test, mock } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Route = require("../models/Route");
const { recommendRoute } = require("../services/routeRecommendationService");
const {
  getRecommendedRoute,
} = require("../controllers/routeRecommendationController");

afterEach(() => mock.restoreAll());

const START_ID = new mongoose.Types.ObjectId().toString();
const END_ID = new mongoose.Types.ObjectId().toString();

test("filters directed route pairs, excludes blocked routes, and ranks by traffic then time", async () => {
  const storedRoutes = [
    {
      routeId: "HIGH-FAST",
      name: "High traffic route",
      distance: 4,
      estimatedTime: 8,
      trafficLevel: "HIGH",
      status: "CONGESTED",
    },
    {
      routeId: "LOW-SLOW",
      name: "Low traffic route",
      distance: 7,
      estimatedTime: 20,
      trafficLevel: "LOW",
      status: "AVAILABLE",
    },
    {
      routeId: "LOW-FAST",
      name: "Preferred stored route",
      distance: 6,
      estimatedTime: 12,
      trafficLevel: "LOW",
      status: "AVAILABLE",
    },
    {
      routeId: "BLOCKED-FAST",
      name: "Blocked route",
      distance: 1,
      estimatedTime: 2,
      trafficLevel: "LOW",
      status: "BLOCKED",
    },
  ];
  let filter;
  mock.method(Route, "find", async (value) => {
    filter = value;
    return storedRoutes.filter(
      (route) =>
        route.status !== "BLOCKED" &&
        value.startLocation === START_ID &&
        value.endLocation === END_ID
    );
  });

  const result = await recommendRoute(START_ID, END_ID);

  assert.deepEqual(filter, {
    startLocation: START_ID,
    endLocation: END_ID,
    status: { $ne: "BLOCKED" },
  });
  assert.equal(result.recommendedRoute.routeId, "LOW-FAST");
  assert.deepEqual(
    result.alternatives.map((route) => route.routeId),
    ["LOW-SLOW", "HIGH-FAST"]
  );
  assert.equal(result.recommendedRoute.status, "AVAILABLE");
  assert.match(result.reason, /low traffic/);
});

test("rejects malformed location IDs before querying routes", async () => {
  const find = mock.method(Route, "find", async () => []);

  await assert.rejects(
    recommendRoute("not-an-id", END_ID),
    (error) => error.statusCode === 400
  );

  assert.equal(find.mock.callCount(), 0);
});

test("reports a missing route with a not-found status", async () => {
  mock.method(Route, "find", async () => []);

  await assert.rejects(
    recommendRoute(START_ID, END_ID),
    (error) =>
      error.message === "No available routes found" && error.statusCode === 404
  );
});

function mockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("controller returns 400 for missing or invalid location IDs", async () => {
  const missing = mockResponse();
  await getRecommendedRoute({ body: { startLocation: START_ID } }, missing);
  assert.equal(missing.statusCode, 400);
  assert.equal(
    missing.body.message,
    "startLocation and endLocation are required"
  );

  const invalid = mockResponse();
  await getRecommendedRoute(
    { body: { startLocation: "invalid", endLocation: END_ID } },
    invalid
  );
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.body.message, /valid location IDs/);
});

test("controller returns 400 when the request body is undefined", async () => {
  const response = mockResponse();

  await getRecommendedRoute({ body: undefined }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(
    response.body.message,
    "startLocation and endLocation are required"
  );
});

test("controller returns 400 when the request has no body property", async () => {
  const response = mockResponse();

  await getRecommendedRoute({}, response);

  assert.equal(response.statusCode, 400);
  assert.equal(
    response.body.message,
    "startLocation and endLocation are required"
  );
});

test("controller returns the recommendation response contract on success", async () => {
  mock.method(Route, "find", async () => [
    {
      routeId: "ROUTE-1",
      name: "Stored route",
      distance: 5,
      estimatedTime: 10,
      trafficLevel: "LOW",
      status: "AVAILABLE",
    },
  ]);
  const response = mockResponse();

  await getRecommendedRoute(
    { body: { startLocation: START_ID, endLocation: END_ID } },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.recommendedRoute.routeId, "ROUTE-1");
  assert.deepEqual(response.body.alternatives, []);
  assert.match(response.body.reason, /low traffic/);
});

test("controller returns 404 for a valid pair with no matching routes", async () => {
  mock.method(Route, "find", async () => []);
  const response = mockResponse();

  await getRecommendedRoute(
    { body: { startLocation: START_ID, endLocation: END_ID } },
    response
  );

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.message, "No available routes found");
});

test("controller preserves 500 responses for unexpected route query failures", async () => {
  mock.method(Route, "find", async () => {
    throw new Error("database unavailable");
  });
  const response = mockResponse();

  await getRecommendedRoute(
    { body: { startLocation: START_ID, endLocation: END_ID } },
    response
  );

  assert.equal(response.statusCode, 500);
  assert.equal(response.body.message, "Failed to recommend route");
  assert.equal(response.body.error, "database unavailable");
});
