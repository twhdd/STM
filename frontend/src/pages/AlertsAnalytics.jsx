import { useEffect, useRef, useState } from "react";
import api from "../services/api";
import { useAuth } from "../context/useAuth";
import { hasRole, roleAccess } from "../config/roleAccess";
import { REALTIME_EVENTS, subscribeToRealtimeEvents } from "../services/realtime";
import "./AlertsAnalytics.css";

const trafficLevels = ["LOW", "MEDIUM", "HIGH", "SEVERE"];

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function getLocationName(location) {
  if (location && typeof location === "object") {
    return [location.name, location.area].filter(Boolean).join(" — ") || "—";
  }
  return "—";
}

function getAlertSeverityClass(severity) {
  if (severity === "CRITICAL") return "badge-danger";
  if (severity === "WARNING") return "badge-warning";
  return "badge-info";
}

function getTrafficLevelClass(level) {
  if (level === "SEVERE") return "badge-danger";
  if (level === "HIGH") return "badge-warning";
  if (level === "MEDIUM") return "badge-info";
  return "badge-success";
}

function formatEventOption(event) {
  const location = getLocationName(event.location);
  const details = [
    location,
    event.congestionLevel,
    event.vehicleCount != null ? `${event.vehicleCount} vehicles` : null,
    formatDateTime(event.detectedAt),
  ].filter(Boolean);
  return details.join(" · ");
}

export function AlertsAnalytics() {
  const { user, token } = useAuth();
  const [analytics, setAnalytics] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitResult, setSubmitResult] = useState(null);
  const [realtimeStatus, setRealtimeStatus] = useState("disconnected");
  const submittingRef = useRef(false);
  const realtimeRefreshTimer = useRef(null);
  const canGenerateAlerts = hasRole(
    user?.role,
    roleAccess.actions.generateTrafficAlert
  );

  useEffect(() => {
    if (!token) return undefined;

    const handleRealtimeEvent = () => {
      if (realtimeRefreshTimer.current) {
        window.clearTimeout(realtimeRefreshTimer.current);
      }
      realtimeRefreshTimer.current = window.setTimeout(() => {
        realtimeRefreshTimer.current = null;
        setRefreshIndex((current) => current + 1);
      }, 150);
    };
    const unsubscribe = subscribeToRealtimeEvents(
      token,
      [
        REALTIME_EVENTS.MEASUREMENT_CREATED,
        REALTIME_EVENTS.CONGESTION_DETECTED,
        REALTIME_EVENTS.CONGESTION_CLEARED,
        REALTIME_EVENTS.ALERT_CREATED,
        REALTIME_EVENTS.ALERT_RESOLVED,
      ],
      handleRealtimeEvent,
      setRealtimeStatus
    );

    return () => {
      unsubscribe();
      if (realtimeRefreshTimer.current) {
        window.clearTimeout(realtimeRefreshTimer.current);
        realtimeRefreshTimer.current = null;
      }
    };
  }, [token]);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboardData() {
      setLoading(true);
      setLoadError("");

      try {
        const [alertsResponse, analyticsResponse, eventsResponse] = await Promise.all([
          api.get("/traffic-alerts"),
          api.get("/traffic-analytics"),
          api.get("/congestion-events"),
        ]);

        if (!Array.isArray(alertsResponse?.alerts)) {
          throw new Error("The server returned an invalid traffic alerts response.");
        }
        if (!analyticsResponse?.analytics || typeof analyticsResponse.analytics !== "object") {
          throw new Error("The server returned an invalid traffic analytics response.");
        }
        if (!Array.isArray(eventsResponse?.events)) {
          throw new Error("The server returned an invalid congestion events response.");
        }

        if (!cancelled) {
          setAlerts(alertsResponse.alerts);
          setAnalytics(analyticsResponse.analytics);
          setEvents(eventsResponse.events);
          setSelectedEventId((current) =>
            eventsResponse.events.some((event) => event._id === current) ? current : ""
          );
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error.message || "Unable to load alerts and traffic analytics.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDashboardData();
    return () => {
      cancelled = true;
    };
  }, [refreshIndex]);

  function handleRefresh() {
    setRefreshIndex((current) => current + 1);
  }

  async function handleGenerateAlert(event) {
    event.preventDefault();
    if (submittingRef.current || !canGenerateAlerts || !selectedEventId) return;

    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError("");
    setSubmitResult(null);

    try {
      const response = await api.post("/traffic-alerts/generate", {
        congestionEventId: selectedEventId,
      });

      if (typeof response?.message !== "string") {
        throw new Error("The server returned an invalid alert generation response.");
      }

      setSubmitResult({
        message: response.message,
        alertCreated: response.alertCreated,
      });
      if (response.alertCreated === true) {
        setSelectedEventId("");
        handleRefresh();
      }
    } catch (error) {
      setSubmitError(
        error.status === 403
          ? `Your account is not authorized to generate traffic alerts. ${
              error.message || "Only administrators and traffic authorities may generate alerts."
            }`
          : error.message || "Unable to generate a traffic alert."
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h2 className="page-title">Alerts &amp; Analytics</h2>
          <p className="page-description">
            Review traffic conditions, congestion trends, and operational alerts.
          </p>
        </div>
        <section className="card loading-card" role="status">
          <div className="auth-loading-spinner" />
          <p>Loading alerts and traffic analytics...</p>
        </section>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h2 className="page-title">Alerts &amp; Analytics</h2>
          <p className="page-description">
            Review traffic conditions, congestion trends, and operational alerts.
          </p>
        </div>
        <section className="card">
          <div className="alert-banner alert-danger" role="alert">
            <span className="alert-icon" aria-hidden="true">⚠️</span>
            <div>
              <strong>Could not load dashboard data.</strong> {loadError}
            </div>
          </div>
          <button type="button" className="btn-primary" onClick={handleRefresh}>
            Retry
          </button>
        </section>
      </div>
    );
  }

  const distribution = analytics.trafficDistribution || {};
  const maxTrafficCount = Math.max(
    0,
    ...trafficLevels.map((level) => Number(distribution[level]) || 0)
  );

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="header-actions-row alerts-analytics-header">
          <div>
            <h2 className="page-title">Alerts &amp; Analytics</h2>
            <p className="page-description">
              Review traffic conditions, congestion trends, and operational alerts.
            </p>
          </div>
          <button
            type="button"
            className="btn-refresh"
            onClick={handleRefresh}
            disabled={submitting}
            title="Refresh alerts and analytics"
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
              aria-hidden="true"
            >
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19" />
            </svg>
            <span>Refresh</span>
          </button>
        </div>
        <p className="page-description" role="status" aria-live="polite">
          {realtimeStatus === "connected"
            ? "Live updates connected"
            : realtimeStatus === "connecting"
              ? "Connecting to live updates..."
              : realtimeStatus === "reconnecting"
                ? "Live updates disconnected; reconnecting..."
                : realtimeStatus === "error"
                  ? "Live updates unavailable; showing REST data."
                  : "Live updates disconnected; showing REST data."}
        </p>
      </div>

      <section className="alerts-analytics-stats stats-grid" aria-label="Traffic analytics summary">
        <div className="stat-card">
          <div className="stat-icon-wrapper stat-primary" aria-hidden="true">◉</div>
          <div className="stat-content">
            <span className="stat-label">Measurements</span>
            <span className="stat-value">{analytics.totalMeasurements ?? "—"}</span>
            <span className="stat-hint">Recorded traffic readings</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper stat-info" aria-hidden="true">↔</div>
          <div className="stat-content">
            <span className="stat-label">Average vehicles</span>
            <span className="stat-value">{analytics.averageVehicleCount ?? "—"}</span>
            <span className="stat-hint">Vehicles per measurement</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper stat-success" aria-hidden="true">⌁</div>
          <div className="stat-content">
            <span className="stat-label">Average speed</span>
            <span className="stat-value">
              {analytics.averageSpeed != null ? `${analytics.averageSpeed} km/h` : "—"}
            </span>
            <span className="stat-hint">Across recorded measurements</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper stat-warning" aria-hidden="true">!</div>
          <div className="stat-content">
            <span className="stat-label">Congestion events</span>
            <span className="stat-value">{analytics.totalCongestionEvents ?? "—"}</span>
            <span className="stat-hint">Total detected events</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper stat-danger" aria-hidden="true">⚑</div>
          <div className="stat-content">
            <span className="stat-label">Active alerts</span>
            <span className="stat-value">{analytics.activeAlerts ?? "—"}</span>
            <span className="stat-hint">Alerts requiring attention</span>
          </div>
        </div>
      </section>

      <section className="card traffic-distribution-card">
        <div className="card-header">
          <h3 className="card-title">Traffic Distribution</h3>
          <p className="card-subtitle">Measurements by reported traffic density.</p>
        </div>
        {analytics.totalMeasurements === 0 ? (
          <p className="empty-state-text">No traffic measurements are available yet.</p>
        ) : (
          <div className="traffic-distribution-list">
            {trafficLevels.map((level) => {
              const count = Number(distribution[level]) || 0;
              const width = maxTrafficCount > 0 ? (count / maxTrafficCount) * 100 : 0;
              return (
                <div className="traffic-distribution-row" key={level}>
                  <div className="traffic-distribution-label">
                    <span className={`badge ${getTrafficLevelClass(level)}`}>{level}</span>
                    <strong>{count}</strong>
                  </div>
                  <div
                    className="traffic-distribution-track"
                    role="img"
                    aria-label={`${level}: ${count} measurements`}
                  >
                    <span
                      className={`traffic-distribution-bar density-${level.toLowerCase()}`}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="card alerts-list-card">
        <div className="card-header">
          <h3 className="card-title">Traffic Alerts</h3>
          <p className="card-subtitle">{alerts.length} alert(s)</p>
        </div>
        {alerts.length === 0 ? (
          <p className="empty-state-text">No traffic alerts found.</p>
        ) : (
          <div className="table-responsive">
            <table className="data-table alerts-data-table">
              <thead>
                <tr>
                  <th>Alert</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Location</th>
                  <th>Event / vehicle</th>
                  <th>Created</th>
                  <th>Resolved</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => (
                  <tr key={alert._id}>
                    <td>
                      <strong>{alert.alertType || "Traffic alert"}</strong>
                      <span className="alert-message">{alert.message}</span>
                    </td>
                    <td>
                      <span className={`badge ${getAlertSeverityClass(alert.severity)}`}>
                        {alert.severity || "—"}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${alert.status === "ACTIVE" ? "badge-warning" : "badge-success"}`}>
                        {alert.status || "—"}
                      </span>
                    </td>
                    <td>{getLocationName(alert.location)}</td>
                    <td>
                      {alert.congestionEvent && typeof alert.congestionEvent === "object" ? (
                        <span>
                          {alert.congestionEvent.congestionLevel || "Congestion"} congestion
                          {alert.congestionEvent.vehicleCount != null
                            ? ` · ${alert.congestionEvent.vehicleCount} vehicles`
                            : ""}
                        </span>
                      ) : alert.emergencyVehicle && typeof alert.emergencyVehicle === "object" ? (
                        <span>
                          {alert.emergencyVehicle.vehicleId} · {alert.emergencyVehicle.vehicleType}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{formatDateTime(alert.createdAt)}</td>
                    <td>{formatDateTime(alert.resolvedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card generate-alert-card">
        <div className="card-header">
          <h3 className="card-title">Generate a Congestion Alert</h3>
          <p className="card-subtitle">
            Create an alert from an existing congestion event.
          </p>
        </div>

        {!canGenerateAlerts && (
          <div className="alert-banner alert-warning" role="note">
            <div>
              Only administrators and traffic authorities can generate traffic alerts.
              Your account does not have either role.
            </div>
          </div>
        )}

        {canGenerateAlerts && events.length === 0 && (
          <p className="empty-state-text">
            No congestion events are available to generate an alert from.
          </p>
        )}

        <form className="generate-alert-form" onSubmit={handleGenerateAlert}>
          <div className="form-group">
            <label className="form-label" htmlFor="congestion-event">
              Congestion event
            </label>
            <select
              id="congestion-event"
              className="form-input"
              value={selectedEventId}
              onChange={(event) => {
                setSelectedEventId(event.target.value);
                setSubmitResult(null);
                setSubmitError("");
              }}
              disabled={!canGenerateAlerts || events.length === 0 || submitting}
              required
            >
              <option value="">Choose a congestion event</option>
              {events.map((event) => (
                <option key={event._id} value={event._id}>
                  {formatEventOption(event)}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="btn-primary"
            disabled={!canGenerateAlerts || events.length === 0 || !selectedEventId || submitting}
          >
            {submitting ? "Generating..." : "Generate Alert"}
          </button>
        </form>

        {submitError && (
          <div className="alert-banner alert-danger generation-feedback" role="alert">
            {submitError}
          </div>
        )}
        {submitResult && (
          <div
            className={`alert-banner ${
              submitResult.alertCreated === false ? "alert-info" : "alert-success"
            } generation-feedback`}
            role="status"
          >
            {submitResult.message}
          </div>
        )}
      </section>
    </div>
  );
}

export default AlertsAnalytics;
