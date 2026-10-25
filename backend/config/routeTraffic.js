// A reading is "fresh" when it is no older than this. The development
// simulator samples every 15 s (STM_TRAFFIC_SIMULATOR_INTERVAL_MS), so 45 s
// tolerates two missed samples. Raise it to at least 3x the real sampling
// interval of any other measurement source.
const DEFAULT_FRESHNESS_MS = 45_000;
const MIN_FRESHNESS_MS = 1_000;
const MAX_FRESHNESS_MS = 60 * 60 * 1000;

function loadRouteTrafficConfig(environment = process.env) {
  const raw = environment.STM_ROUTE_TRAFFIC_FRESHNESS_MS;

  if (raw === undefined) {
    return Object.freeze({ freshnessMs: DEFAULT_FRESHNESS_MS });
  }

  const freshnessMs = /^\d+$/.test(raw) ? Number(raw) : NaN;

  if (
    !Number.isSafeInteger(freshnessMs) ||
    freshnessMs < MIN_FRESHNESS_MS ||
    freshnessMs > MAX_FRESHNESS_MS
  ) {
    throw new Error(
      `STM_ROUTE_TRAFFIC_FRESHNESS_MS must be an integer between ${MIN_FRESHNESS_MS} and ${MAX_FRESHNESS_MS} milliseconds`
    );
  }

  return Object.freeze({ freshnessMs });
}

module.exports = {
  DEFAULT_FRESHNESS_MS,
  MAX_FRESHNESS_MS,
  MIN_FRESHNESS_MS,
  loadRouteTrafficConfig,
};
