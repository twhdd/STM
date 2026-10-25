import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyPriorityChange,
  formatActiveSince,
  priorityErrorMessage,
} from "./emergencyPriorityDisplay.js";

test("formatActiveSince renders a readable timestamp and rejects missing or invalid values", () => {
  const label = formatActiveSince("2026-10-18T14:19:17.827Z", { timeZone: "UTC" });
  assert.ok(label.includes("Oct 18"), label);
  assert.match(label, /02:19/);
  assert.equal(formatActiveSince(undefined), null);
  assert.equal(formatActiveSince(null), null);
  assert.equal(formatActiveSince("not a date"), null);
});

test("applyPriorityChange updates only the matching vehicle and does not mutate the input", () => {
  const vehicles = [
    { _id: "a", vehicleId: "AMB-1", priorityActive: false },
    { _id: "b", vehicleId: "AMB-2", priorityActive: true, activatedAt: "2026-10-18T14:19:17.827Z" },
  ];
  const snapshot = JSON.stringify(vehicles);

  const activated = applyPriorityChange(vehicles, "a", {
    priorityActive: true,
    activatedAt: "2026-10-25T09:00:00.000Z",
  });
  assert.equal(activated[0].priorityActive, true);
  assert.equal(activated[0].activatedAt, "2026-10-25T09:00:00.000Z");
  assert.equal(activated[1], vehicles[1]);

  const deactivated = applyPriorityChange(vehicles, "b", { priorityActive: false });
  assert.equal(deactivated[1].priorityActive, false);
  assert.equal(deactivated[1].activatedAt, null);
  assert.equal(JSON.stringify(vehicles), snapshot);
});

test("priorityErrorMessage explains each server error code", () => {
  const withCode = (code, message = "server text", status = 409) => ({ status, message, data: { code } });
  assert.match(priorityErrorMessage(withCode("PRIORITY_NOT_ACTIVE"), "deactivate"), /not active/i);
  assert.match(priorityErrorMessage(withCode("PRIORITY_ALREADY_ACTIVE"), "activate"), /already active/i);
  assert.match(priorityErrorMessage(withCode("SIGNAL_ALREADY_OVERRIDDEN"), "activate"), /another emergency vehicle/i);
  assert.match(priorityErrorMessage(withCode("NO_ACTIVE_SIGNAL"), "activate"), /no active traffic signal/i);
  assert.match(priorityErrorMessage(withCode("VEHICLE_INACTIVE"), "activate"), /inactive/i);
  assert.match(priorityErrorMessage(withCode("SIGNAL_CHANGED"), "activate"), /try again/i);
});

test("priorityErrorMessage handles authorization failures and unknown errors", () => {
  assert.match(
    priorityErrorMessage({ status: 403, message: "denied" }, "deactivate"),
    /not authorized to deactivate emergency priority/i
  );
  assert.equal(priorityErrorMessage({ message: "Network down" }, "activate"), "Network down");
  assert.equal(priorityErrorMessage({}, "deactivate"), "Unable to deactivate emergency priority.");
});
