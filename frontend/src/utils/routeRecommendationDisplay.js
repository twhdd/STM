const STATIC_TITLE = "Static route data — not live traffic";

function formatLevel(level) {
  return level ? level.charAt(0) + level.slice(1).toLowerCase() : "Unknown";
}

function allRoutes(result) {
  return [result?.recommendedRoute, ...(result?.alternatives || [])].filter(Boolean);
}

export function describeBasis(result) {
  const seconds = result?.freshnessThresholdSeconds;
  const window = Number.isFinite(seconds) ? `${seconds} seconds` : "the freshness window";

  if (result?.basis === "LIVE_MEASUREMENTS") {
    const simulated = allRoutes(result).some((route) =>
      route.trafficStatus?.sources?.includes("SIMULATOR")
    );
    return {
      live: true,
      title: "Ranked on live measurements",
      detail:
        `Every route option has a reading no older than ${window} at all of its waypoints.` +
        (simulated ? " These are simulated measurements, not real road traffic." : ""),
    };
  }

  const reasons = {
    NO_WAYPOINTS:
      "At least one route option has no monitored waypoints, so the options cannot be compared using measurements.",
    NO_FRESH_DATA: `At least one route option has no fresh measurements (none within ${window}) at its waypoints.`,
    PARTIAL_DATA:
      "Measurements cover only some waypoints of at least one route option.",
  };

  return {
    live: false,
    title: STATIC_TITLE,
    detail:
      (reasons[result?.fallbackReason] ||
        "The server did not report that live measurements were used.") +
      " The ranking uses stored traffic levels and stored time estimates.",
  };
}

export function describeRouteTraffic(route, { rankedOnLive = false } = {}) {
  const status = route?.trafficStatus;

  if (!status) {
    return {
      label: "Not reported",
      level: null,
      detail: "The server did not report live traffic for this route.",
    };
  }

  const coverage = `${status.coverage?.fresh ?? 0} of ${status.coverage?.total ?? 0} waypoints`;

  switch (status.state) {
    case "LIVE":
      return {
        label: `Live: ${formatLevel(status.level)}`,
        level: status.level,
        detail:
          `Based on ${coverage}; oldest reading ${status.ageSeconds} seconds ago.` +
          (status.conflicting ? " Conflicting readings; the worst was used." : "") +
          (rankedOnLive ? "" : " Shown for information only; this ranking uses stored data."),
      };
    case "PARTIAL":
      return {
        label: "Partial live data",
        level: status.level,
        detail: `Fresh at ${coverage} (worst seen: ${formatLevel(status.level)}); not used for ranking.`,
      };
    case "STALE": {
      const last = status.lastObservedAt ? new Date(status.lastObservedAt) : null;
      return {
        label: "Stale data",
        level: null,
        detail: `Last reading ${
          last && !Number.isNaN(last.getTime()) ? last.toLocaleString() : "time unknown"
        }; too old to show as current.`,
      };
    }
    case "NO_DATA":
      return {
        label: "No recent measurements",
        level: null,
        detail: "No usable measurement was found at this route's waypoints in the last 24 hours.",
      };
    case "NO_WAYPOINTS":
      return {
        label: "No monitored waypoints",
        level: null,
        detail: "This route has no waypoints configured, so no live traffic can be derived.",
      };
    default:
      return {
        label: "Not reported",
        level: null,
        detail: "The server did not report live traffic for this route.",
      };
  }
}
