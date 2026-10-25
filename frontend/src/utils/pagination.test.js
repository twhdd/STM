import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampPage,
  describePageRange,
  readPagination,
  withPageQuery,
} from "./pagination.js";

test("withPageQuery builds a stable query string and skips empty values", () => {
  assert.equal(withPageQuery("/traffic-measurements"), "/traffic-measurements");
  assert.equal(
    withPageQuery("/traffic-measurements", { page: 2, limit: 25 }),
    "/traffic-measurements?page=2&limit=25"
  );
  assert.equal(
    withPageQuery("/congestion-events", { status: "ACTIVE", limit: 1, page: undefined }),
    "/congestion-events?limit=1&status=ACTIVE"
  );
  assert.equal(
    withPageQuery("/traffic-measurements", { page: 1, limit: 25, location: "a b" }),
    "/traffic-measurements?page=1&limit=25&location=a%20b"
  );
  assert.equal(withPageQuery("/x", { status: "", location: null }), "/x");
});

test("readPagination passes through valid server metadata", () => {
  const response = { measurements: [1, 2], pagination: { page: 3, limit: 25, total: 60, totalPages: 3 } };
  assert.deepEqual(readPagination(response, 2), { page: 3, limit: 25, total: 60, totalPages: 3 });
});

test("readPagination derives safe metadata when the server sends none or garbage", () => {
  assert.deepEqual(readPagination({}, 0), { page: 1, limit: 1, total: 0, totalPages: 0 });
  assert.deepEqual(readPagination({}, 4), { page: 1, limit: 4, total: 4, totalPages: 1 });
  assert.deepEqual(readPagination(null, 3), { page: 1, limit: 3, total: 3, totalPages: 1 });
  for (const pagination of [
    { page: 0, limit: 25, total: 5, totalPages: 1 },
    { page: "2", limit: 25, total: 5, totalPages: 1 },
    { page: 1, limit: -1, total: 5, totalPages: 1 },
    { page: 1, limit: 25, total: -5, totalPages: 1 },
    { page: 1, limit: 25, total: 5.5, totalPages: 1 },
  ]) {
    assert.deepEqual(readPagination({ pagination }, 2), { page: 1, limit: 2, total: 2, totalPages: 1 });
  }
});

test("describePageRange labels empty, first, middle, last and out-of-range pages", () => {
  assert.equal(describePageRange({ page: 1, limit: 25, total: 0 }), "No records");
  assert.equal(describePageRange({ page: 1, limit: 25, total: 386 }), "Showing 1–25 of 386");
  assert.equal(describePageRange({ page: 2, limit: 25, total: 386 }), "Showing 26–50 of 386");
  assert.equal(describePageRange({ page: 16, limit: 25, total: 386 }), "Showing 376–386 of 386");
  assert.equal(describePageRange({ page: 1, limit: 25, total: 1 }), "Showing 1–1 of 1");
  assert.equal(describePageRange({ page: 99, limit: 25, total: 386 }), "No records on this page (386 total)");
});

test("clampPage keeps a page inside 1..totalPages", () => {
  assert.equal(clampPage(5, 3), 3);
  assert.equal(clampPage(0, 3), 1);
  assert.equal(clampPage(-2, 3), 1);
  assert.equal(clampPage(2, 3), 2);
  assert.equal(clampPage(4, 0), 1);
  assert.equal(clampPage(2.7, 5), 1);
});
