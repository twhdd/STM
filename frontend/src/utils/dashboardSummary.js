export function getRecentAlerts(alerts, limit = 5) {
  if (!Array.isArray(alerts)) return [];

  return [...alerts]
    .sort((a, b) => {
      const aTime = Date.parse(a.createdAt || "") || 0;
      const bTime = Date.parse(b.createdAt || "") || 0;
      return bTime - aTime;
    })
    .slice(0, Math.max(0, limit));
}

export function getMonitoringStatuses({
  analytics,
  locations,
  alerts,
  feedErrors,
  realtimeStatus,
}) {
  const feedUnavailable = (label) =>
    feedErrors.some((error) => error.startsWith(`${label}:`));
  const hasMeasurementCount =
    Number.isFinite(analytics?.totalMeasurements) &&
    !feedUnavailable("Traffic analytics");
  const locationsAvailable = !feedUnavailable("Traffic locations");
  const alertsAvailable = !feedUnavailable("Traffic alerts");
  const measurementCount = analytics?.totalMeasurements;
  const locationCount = Array.isArray(locations) ? locations.length : 0;
  const activeAlertCount = Array.isArray(alerts)
    ? alerts.filter((alert) => alert.status === "ACTIVE").length
    : 0;

  return [
    {
      label: "Traffic measurements",
      value: !hasMeasurementCount
        ? "Unavailable"
        : measurementCount > 0
          ? `${measurementCount} recorded`
          : "No measurements",
      state: !hasMeasurementCount
        ? "unavailable"
        : measurementCount > 0
          ? "available"
          : "empty",
    },
    {
      label: "Monitoring locations",
      value: !locationsAvailable
        ? "Unavailable"
        : locationCount > 0
          ? `${locationCount} configured`
          : "None configured",
      state: !locationsAvailable
        ? "unavailable"
        : locationCount > 0
          ? "available"
          : "empty",
    },
    {
      label: "Active alerts",
      value: !alertsAvailable
        ? "Unavailable"
        : activeAlertCount > 0
          ? `${activeAlertCount} active`
          : "None active",
      state: !alertsAvailable
        ? "unavailable"
        : activeAlertCount > 0
          ? "warning"
          : "available",
    },
    {
      label: "Live updates",
      value:
        realtimeStatus === "connected"
          ? "Connected"
          : realtimeStatus === "connecting"
            ? "Connecting"
            : realtimeStatus === "reconnecting"
              ? "Reconnecting; REST fallback"
              : realtimeStatus === "error"
                ? "Unavailable; REST fallback"
                : "Disconnected; REST fallback",
      state:
        realtimeStatus === "connected"
          ? "available"
          : realtimeStatus === "connecting" || realtimeStatus === "reconnecting"
            ? "warning"
            : "unavailable",
    },
  ];
}
