import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMeasurementSource } from "./trafficMeasurementDisplay.js";

test("labels simulator and API measurement sources without asserting live provenance", () => {
  assert.equal(formatMeasurementSource("SIMULATOR"), "Simulator");
  assert.equal(formatMeasurementSource("API"), "API submitted");
});

test("labels missing or unsupported measurement sources explicitly", () => {
  assert.equal(formatMeasurementSource(undefined), "Unknown source");
  assert.equal(formatMeasurementSource("EXTERNAL"), "Unknown source");
});
