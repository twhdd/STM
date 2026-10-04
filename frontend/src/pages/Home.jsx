import { useState, useEffect } from "react";
import api from "../services/api";

export function Home() {
  const [analytics, setAnalytics] = useState(null);
  const [locations, setLocations] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [congestionEvents, setCongestionEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    let isCancelled = false;

    async function fetchDashboard() {
      try {
        const [analyticsRes, locationsRes, alertsRes, eventsRes] = await Promise.allSettled([
          api.get("/traffic-analytics"),
          api.get("/traffic-locations"),
          api.get("/traffic-alerts"),
          api.get("/congestion-events"),
        ]);

        if (!isCancelled) {
          if (analyticsRes.status === "fulfilled" && analyticsRes.value?.analytics) {
            setAnalytics(analyticsRes.value.analytics);
          } else {
            setAnalytics(null);
          }

          if (locationsRes.status === "fulfilled" && Array.isArray(locationsRes.value?.locations)) {
            setLocations(locationsRes.value.locations);
          } else {
            setLocations([]);
          }

          if (alertsRes.status === "fulfilled" && Array.isArray(alertsRes.value?.alerts)) {
            setAlerts(alertsRes.value.alerts);
          } else {
            setAlerts([]);
          }

          if (eventsRes.status === "fulfilled" && Array.isArray(eventsRes.value?.events)) {
            setCongestionEvents(eventsRes.value.events);
          } else {
            setCongestionEvents([]);
          }

          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (!isCancelled) {
          console.error("Failed to load dashboard data:", err);
          setError(err.message || "Failed to load real-time traffic dashboard data.");
          setLoading(false);
        }
      }
    }

    fetchDashboard();

    return () => {
      isCancelled = true;
    };
  }, [refreshIndex]);

  const handleRefresh = () => {
    setLoading(true);
    setRefreshIndex((prev) => prev + 1);
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h2 className="page-title">Operations Dashboard</h2>
          <p className="page-description">Loading real-time traffic network data...</p>
        </div>
        <div className="card loading-card">
          <div className="auth-loading-spinner"></div>
          <p>Retrieving traffic analytics and telemetry...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h2 className="page-title">Operations Dashboard</h2>
        </div>
        <div className="card">
          <div className="alert-banner alert-danger">
            <span className="alert-icon">⚠️</span>
            <div>
              <strong>Error Loading Data: </strong>
              <span>{error}</span>
            </div>
          </div>
          <button type="button" className="btn-primary" onClick={handleRefresh} style={{ marginTop: "16px" }}>
            Retry Loading Data
          </button>
        </div>
      </div>
    );
  }

  const distribution = analytics?.trafficDistribution || {};
  const hasMeasurements = (analytics?.totalMeasurements || 0) > 0;

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="header-actions-row">
          <div>
            <h2 className="page-title">Operations Dashboard</h2>
            <p className="page-description">
              Real-time traffic telemetry, automated congestion status, and active incident feed.
            </p>
          </div>
          <button type="button" className="btn-refresh" onClick={handleRefresh} title="Refresh Telemetry">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19" />
            </svg>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* KPI Metric Cards Grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon-wrapper stat-primary">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M3 9h18M9 21V9" />
            </svg>
          </div>
          <div className="stat-content">
            <span className="stat-label">Total Measurements</span>
            <span className="stat-value">{analytics ? analytics.totalMeasurements : 0}</span>
            <span className="stat-hint">Recorded sensor cycles</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon-wrapper stat-info">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1 .4-1 1v9h2" />
              <circle cx="7" cy="17" r="2" />
              <path d="M9 17h6" />
              <circle cx="17" cy="17" r="2" />
            </svg>
          </div>
          <div className="stat-content">
            <span className="stat-label">Average Vehicle Count</span>
            <span className="stat-value">{analytics ? `${analytics.averageVehicleCount}` : "0"}</span>
            <span className="stat-hint">Vehicles per interval</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon-wrapper stat-success">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m12 14 4-4" />
              <path d="M3.34 19a10 10 0 1 1 17.32 0" />
            </svg>
          </div>
          <div className="stat-content">
            <span className="stat-label">Average Speed</span>
            <span className="stat-value">{analytics ? `${analytics.averageSpeed} km/h` : "0 km/h"}</span>
            <span className="stat-hint">Corridor flow velocity</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon-wrapper stat-warning">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div className="stat-content">
            <span className="stat-label">Congestion Events</span>
            <span className="stat-value">{analytics ? analytics.totalCongestionEvents : 0}</span>
            <span className="stat-hint">Detected bottleneck incidents</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon-wrapper stat-danger">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
          </div>
          <div className="stat-content">
            <span className="stat-label">Active Alerts</span>
            <span className="stat-value">{analytics ? analytics.activeAlerts : 0}</span>
            <span className="stat-hint">Unresolved high-priority notices</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon-wrapper stat-neutral">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </div>
          <div className="stat-content">
            <span className="stat-label">Monitored Locations</span>
            <span className="stat-value">{locations.length}</span>
            <span className="stat-hint">Connected sensor nodes</span>
          </div>
        </div>
      </div>

      {/* Analytics & Traffic Distribution Breakdown */}
      <div className="dashboard-columns">
        <div className="card dashboard-card">
          <div className="card-header">
            <h3 className="card-title">Traffic Density Distribution</h3>
            <span className="card-subtitle">Real-time measurement categorization</span>
          </div>
          <div className="card-body">
            {!hasMeasurements ? (
              <p className="empty-state-text">No traffic measurements available.</p>
            ) : (
              <div className="density-grid">
                <div className="density-item density-low">
                  <div className="density-header">
                    <span className="density-tag">LOW</span>
                    <span className="density-count">{distribution.LOW || 0}</span>
                  </div>
                  <div className="density-bar-track">
                    <div
                      className="density-bar-fill fill-low"
                      style={{
                        width: `${((distribution.LOW || 0) / (analytics?.totalMeasurements || 1)) * 100}%`,
                      }}
                    ></div>
                  </div>
                </div>

                <div className="density-item density-medium">
                  <div className="density-header">
                    <span className="density-tag">MEDIUM</span>
                    <span className="density-count">{distribution.MEDIUM || 0}</span>
                  </div>
                  <div className="density-bar-track">
                    <div
                      className="density-bar-fill fill-medium"
                      style={{
                        width: `${((distribution.MEDIUM || 0) / (analytics?.totalMeasurements || 1)) * 100}%`,
                      }}
                    ></div>
                  </div>
                </div>

                <div className="density-item density-high">
                  <div className="density-header">
                    <span className="density-tag">HIGH</span>
                    <span className="density-count">{distribution.HIGH || 0}</span>
                  </div>
                  <div className="density-bar-track">
                    <div
                      className="density-bar-fill fill-high"
                      style={{
                        width: `${((distribution.HIGH || 0) / (analytics?.totalMeasurements || 1)) * 100}%`,
                      }}
                    ></div>
                  </div>
                </div>

                <div className="density-item density-severe">
                  <div className="density-header">
                    <span className="density-tag">SEVERE</span>
                    <span className="density-count">{distribution.SEVERE || 0}</span>
                  </div>
                  <div className="density-bar-track">
                    <div
                      className="density-bar-fill fill-severe"
                      style={{
                        width: `${((distribution.SEVERE || 0) / (analytics?.totalMeasurements || 1)) * 100}%`,
                      }}
                    ></div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Monitored Locations Section */}
        <div className="card dashboard-card">
          <div className="card-header">
            <h3 className="card-title">Monitored Locations</h3>
            <span className="card-subtitle">{locations.length} active node(s)</span>
          </div>
          <div className="card-body">
            {locations.length === 0 ? (
              <p className="empty-state-text">No traffic locations available.</p>
            ) : (
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Location Name</th>
                      <th>Area</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locations.map((loc) => (
                      <tr key={loc._id || loc.name}>
                        <td className="font-semibold">{loc.name}</td>
                        <td>{loc.area}</td>
                        <td>
                          <span
                            className={`badge ${
                              loc.status === "ACTIVE" ? "badge-success" : "badge-neutral"
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
      </div>

      {/* Recent Alerts & Congestion Events Grid */}
      <div className="dashboard-columns">
        {/* Real Active Traffic Alerts */}
        <div className="card dashboard-card">
          <div className="card-header">
            <h3 className="card-title">Recent Traffic Alerts</h3>
            <span className="card-subtitle">{alerts.length} total alert(s)</span>
          </div>
          <div className="card-body">
            {alerts.length === 0 ? (
              <p className="empty-state-text">No active traffic alerts.</p>
            ) : (
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Message</th>
                      <th>Severity</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.map((alert) => (
                      <tr key={alert._id}>
                        <td>
                          <span className="font-semibold">{alert.alertType}</span>
                        </td>
                        <td>{alert.message}</td>
                        <td>
                          <span
                            className={`badge ${
                              alert.severity === "CRITICAL"
                                ? "badge-danger"
                                : alert.severity === "WARNING"
                                ? "badge-warning"
                                : "badge-info"
                            }`}
                          >
                            {alert.severity}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              alert.status === "ACTIVE" ? "badge-danger" : "badge-neutral"
                            }`}
                          >
                            {alert.status}
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

        {/* Real Congestion Events */}
        <div className="card dashboard-card">
          <div className="card-header">
            <h3 className="card-title">Congestion Incidents</h3>
            <span className="card-subtitle">{congestionEvents.length} recorded event(s)</span>
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
                      <th>Level</th>
                      <th>Vehicles</th>
                      <th>Avg Speed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {congestionEvents.map((event) => (
                      <tr key={event._id}>
                        <td className="font-semibold">
                          {event.location?.name || event.location || "Intersection"}
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              event.congestionLevel === "SEVERE"
                                ? "badge-danger"
                                : event.congestionLevel === "HIGH"
                                ? "badge-warning"
                                : "badge-info"
                            }`}
                          >
                            {event.congestionLevel}
                          </span>
                        </td>
                        <td>{event.vehicleCount ?? "—"}</td>
                        <td>{event.averageSpeed ? `${event.averageSpeed} km/h` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Home;
