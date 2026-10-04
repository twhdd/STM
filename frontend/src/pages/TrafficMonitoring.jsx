import { useState, useEffect } from "react";
import api from "../services/api";

function formatDateTime(dateStr) {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function TrafficMonitoring() {
  const [locations, setLocations] = useState([]);
  const [devices, setDevices] = useState([]);
  const [measurements, setMeasurements] = useState([]);
  const [congestionEvents, setCongestionEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    let isCancelled = false;

    async function fetchMonitoringData() {
      try {
        const [locationsRes, devicesRes, measurementsRes, eventsRes] =
          await Promise.allSettled([
            api.get("/traffic-locations"),
            api.get("/monitoring-devices"),
            api.get("/traffic-measurements"),
            api.get("/congestion-events"),
          ]);

        if (!isCancelled) {
          if (
            locationsRes.status === "fulfilled" &&
            Array.isArray(locationsRes.value?.locations)
          ) {
            setLocations(locationsRes.value.locations);
          } else {
            setLocations([]);
          }

          if (
            devicesRes.status === "fulfilled" &&
            Array.isArray(devicesRes.value?.devices)
          ) {
            setDevices(devicesRes.value.devices);
          } else {
            setDevices([]);
          }

          if (
            measurementsRes.status === "fulfilled" &&
            Array.isArray(measurementsRes.value?.measurements)
          ) {
            // Sort measurements by measuredAt descending (newest first)
            const sorted = [...measurementsRes.value.measurements].sort(
              (a, b) => new Date(b.measuredAt || 0) - new Date(a.measuredAt || 0)
            );
            setMeasurements(sorted);
          } else {
            setMeasurements([]);
          }

          if (
            eventsRes.status === "fulfilled" &&
            Array.isArray(eventsRes.value?.events)
          ) {
            setCongestionEvents(eventsRes.value.events);
          } else {
            setCongestionEvents([]);
          }

          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (!isCancelled) {
          console.error("Failed to load traffic monitoring data:", err);
          setError(
            err.message || "Failed to load real-time traffic monitoring data."
          );
          setLoading(false);
        }
      }
    }

    fetchMonitoringData();

    return () => {
      isCancelled = true;
    };
  }, [refreshIndex]);

  const handleRefresh = () => {
    setLoading(true);
    setRefreshIndex((prev) => prev + 1);
  };

  // Helper to resolve location name if location is an ID string instead of populated object
  const resolveLocationName = (locationRef) => {
    if (!locationRef) return "—";
    if (typeof locationRef === "object" && locationRef.name) {
      return locationRef.name;
    }
    const found = locations.find((l) => l._id === locationRef);
    return found ? found.name : "Unknown Location";
  };

  const activeCongestionCount = congestionEvents.filter(
    (e) => e.status === "ACTIVE"
  ).length;

  if (loading) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h2 className="page-title">Traffic Monitoring</h2>
          <p className="page-description">
            Retrieving live intersection telemetry, device streams, and congestion detections...
          </p>
        </div>
        <div className="card loading-card">
          <div className="auth-loading-spinner"></div>
          <p>Connecting to traffic sensor feeds...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h2 className="page-title">Traffic Monitoring</h2>
        </div>
        <div className="card">
          <div className="alert-banner alert-danger">
            <span className="alert-icon">⚠️</span>
            <div>
              <strong>Error Loading Monitoring Data: </strong>
              <span>{error}</span>
            </div>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={handleRefresh}
            style={{ marginTop: "16px" }}
          >
            Retry Loading Feeds
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* 1. Page Header */}
      <div className="page-header">
        <div className="header-actions-row">
          <div>
            <h2 className="page-title">Traffic Monitoring</h2>
            <p className="page-description">
              Monitors current traffic conditions, monitoring devices, telemetry measurements, and automated congestion detections.
            </p>
          </div>
          <button
            type="button"
            className="btn-refresh"
            onClick={handleRefresh}
            title="Refresh Monitoring Data"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19" />
            </svg>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* 2. Summary Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon-wrapper stat-primary">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </div>
          <div className="stat-content">
            <span className="stat-label">Monitored Locations</span>
            <span className="stat-value">{locations.length}</span>
            <span className="stat-hint">Active intersections</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon-wrapper stat-info">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
              <circle cx="12" cy="13" r="3" />
            </svg>
          </div>
          <div className="stat-content">
            <span className="stat-label">Monitoring Devices</span>
            <span className="stat-value">{devices.length}</span>
            <span className="stat-hint">CCTV & sensor units</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon-wrapper stat-success">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M3 9h18M9 21V9" />
            </svg>
          </div>
          <div className="stat-content">
            <span className="stat-label">Traffic Measurements</span>
            <span className="stat-value">{measurements.length}</span>
            <span className="stat-hint">Recorded sensor cycles</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon-wrapper stat-danger">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div className="stat-content">
            <span className="stat-label">Active Congestion Events</span>
            <span className="stat-value">{activeCongestionCount}</span>
            <span className="stat-hint">Live bottleneck alerts</span>
          </div>
        </div>
      </div>

      {/* 3. Traffic Locations & 4. Monitoring Devices in 2-column layout */}
      <div className="dashboard-columns">
        {/* Traffic Locations */}
        <div className="card dashboard-card">
          <div className="card-header">
            <h3 className="card-title">Traffic Locations</h3>
            <span className="card-subtitle">
              {locations.length} location(s) configured
            </span>
          </div>
          <div className="card-body">
            {locations.length === 0 ? (
              <p className="empty-state-text">No traffic locations found.</p>
            ) : (
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Location Name</th>
                      <th>Area</th>
                      <th>Coordinates</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locations.map((loc) => (
                      <tr key={loc._id || loc.name}>
                        <td className="font-semibold">{loc.name}</td>
                        <td>{loc.area}</td>
                        <td>
                          {loc.latitude != null && loc.longitude != null
                            ? `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`
                            : "—"}
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              loc.status === "ACTIVE"
                                ? "badge-success"
                                : "badge-neutral"
                            }`}
                          >
                            {loc.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Monitoring Devices */}
        <div className="card dashboard-card">
          <div className="card-header">
            <h3 className="card-title">Monitoring Devices</h3>
            <span className="card-subtitle">
              {devices.length} registered hardware device(s)
            </span>
          </div>
          <div className="card-body">
            {devices.length === 0 ? (
              <p className="empty-state-text">No monitoring devices registered.</p>
            ) : (
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Device ID</th>
                      <th>Name / Type</th>
                      <th>Location</th>
                      <th>Status</th>
                      <th>Last Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((device) => (
                      <tr key={device._id || device.deviceId}>
                        <td className="font-semibold">{device.deviceId}</td>
                        <td>
                          <div>{device.name}</div>
                          <small style={{ color: "var(--text-muted)" }}>
                            {device.deviceType}
                          </small>
                        </td>
                        <td>{resolveLocationName(device.location)}</td>
                        <td>
                          <span
                            className={`badge ${
                              device.status === "ACTIVE"
                                ? "badge-success"
                                : device.status === "INACTIVE"
                                ? "badge-neutral"
                                : "badge-warning"
                            }`}
                          >
                            {device.status}
                          </span>
                        </td>
                        <td>{formatDateTime(device.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 5. Latest Traffic Measurements */}
      <div className="card dashboard-card" style={{ marginBottom: "20px" }}>
        <div className="card-header">
          <h3 className="card-title">Latest Traffic Measurements</h3>
          <span className="card-subtitle">
            {measurements.length} telemetry cycle(s) recorded (newest first)
          </span>
        </div>
        <div className="card-body">
          {measurements.length === 0 ? (
            <p className="empty-state-text">No traffic measurements available.</p>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Location</th>
                    <th>Device</th>
                    <th>Vehicle Count</th>
                    <th>Average Speed</th>
                    <th>Traffic Density</th>
                    <th>Measured At</th>
                  </tr>
                </thead>
                <tbody>
                  {measurements.map((m) => (
                    <tr key={m._id}>
                      <td className="font-semibold">
                        {resolveLocationName(m.location)}
                      </td>
                      <td>{m.device?.name || m.device?.deviceId || "—"}</td>
                      <td>{m.vehicleCount ?? "—"}</td>
                      <td>
                        {m.averageSpeed != null ? `${m.averageSpeed} km/h` : "—"}
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            m.trafficDensity === "SEVERE"
                              ? "badge-danger"
                              : m.trafficDensity === "HIGH"
                              ? "badge-warning"
                              : m.trafficDensity === "MEDIUM"
                              ? "badge-info"
                              : "badge-success"
                          }`}
                        >
                          {m.trafficDensity}
                        </span>
                      </td>
                      <td>{formatDateTime(m.measuredAt || m.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 6. Congestion Events */}
      <div className="card dashboard-card">
        <div className="card-header">
          <h3 className="card-title">Congestion Events</h3>
          <span className="card-subtitle">
            {congestionEvents.length} automated incident detection(s)
          </span>
        </div>
        <div className="card-body">
          {congestionEvents.length === 0 ? (
            <p className="empty-state-text">No congestion events detected.</p>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Location</th>
                    <th>Congestion Level</th>
                    <th>Vehicle Count</th>
                    <th>Average Speed</th>
                    <th>Description</th>
                    <th>Status</th>
                    <th>Detected At</th>
                  </tr>
                </thead>
                <tbody>
                  {congestionEvents.map((event) => (
                    <tr key={event._id}>
                      <td className="font-semibold">
                        {resolveLocationName(event.location)}
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            event.congestionLevel === "SEVERE"
                              ? "badge-danger"
                              : event.congestionLevel === "HIGH"
                              ? "badge-warning"
                              : event.congestionLevel === "MEDIUM"
                              ? "badge-info"
                              : "badge-success"
                          }`}
                        >
                          {event.congestionLevel}
                        </span>
                      </td>
                      <td>{event.vehicleCount ?? "—"}</td>
                      <td>
                        {event.averageSpeed != null
                          ? `${event.averageSpeed} km/h`
                          : "—"}
                      </td>
                      <td>{event.description || "—"}</td>
                      <td>
                        <span
                          className={`badge ${
                            event.status === "ACTIVE"
                              ? "badge-danger"
                              : "badge-success"
                          }`}
                        >
                          {event.status}
                        </span>
                      </td>
                      <td>
                        {formatDateTime(event.detectedAt || event.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TrafficMonitoring;
