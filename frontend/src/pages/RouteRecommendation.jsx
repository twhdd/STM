
import { useEffect, useState } from "react";
import api from "../services/api";
import "./RouteRecommendation.css";

const trafficClass = {
  LOW: "badge-success",
  MEDIUM: "badge-info",
  HIGH: "badge-warning",
  SEVERE: "badge-danger",
};

function formatTraffic(level) {
  return level ? level.charAt(0) + level.slice(1).toLowerCase() : "Unknown";
}

function RouteCard({ route, recommended = false }) {
  return (
    <article className={`route-result-card${recommended ? " route-result-best" : ""}`}>
      <div className="route-result-top">
        <div>
          <span className="route-id">{route.routeId || "Route"}</span>
          <h3 className="route-name">{route.name || "Unnamed route"}</h3>
        </div>
        {recommended && <span className="route-recommended-label">Best match</span>}
      </div>

      <div className="route-metrics">
        <div className="route-metric">
          <span className="route-metric-label">Distance</span>
          <strong>{route.distance ?? "—"}</strong>
        </div>
        <div className="route-metric">
          <span className="route-metric-label">Estimated time</span>
          <strong>
            {route.estimatedTime != null ? `${route.estimatedTime} min` : "—"}
          </strong>
        </div>
        <div className="route-metric">
          <span className="route-metric-label">Traffic</span>
          <span className={`badge ${trafficClass[route.trafficLevel] || "badge-neutral"}`}>
            {formatTraffic(route.trafficLevel)}
          </span>
        </div>
      </div>

      <div className="route-result-footer">
        <span className="route-metric-label">Route status</span>
        <span className={`badge ${route.status === "AVAILABLE" ? "badge-success" : "badge-warning"}`}>
          {route.status || "Unknown"}
        </span>
      </div>
    </article>
  );
}

export function RouteRecommendation() {
  const [locations, setLocations] = useState([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [locationsError, setLocationsError] = useState("");
  const [locationsRefreshIndex, setLocationsRefreshIndex] = useState(0);
  const [startLocation, setStartLocation] = useState("");
  const [endLocation, setEndLocation] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadLocations() {
      setLocationsLoading(true);
      setLocationsError("");

      try {
        const response = await api.get("/traffic-locations");
        const availableLocations = Array.isArray(response?.locations)
          ? response.locations.filter((location) => location.status !== "INACTIVE")
          : [];

        if (!cancelled) {
          setLocations(availableLocations);
          setStartLocation((current) =>
            availableLocations.some((location) => location._id === current)
              ? current
              : ""
          );
          setEndLocation((current) =>
            availableLocations.some((location) => location._id === current)
              ? current
              : ""
          );
        }
      } catch (err) {
        if (!cancelled) {
          setLocationsError(err.message || "Could not load traffic locations.");
        }
      } finally {
        if (!cancelled) setLocationsLoading(false);
      }
    }

    loadLocations();
    return () => {
      cancelled = true;
    };
  }, [locationsRefreshIndex]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setResult(null);

    if (!startLocation || !endLocation) {
      setError("Select both a starting point and a destination.");
      return;
    }

    if (startLocation === endLocation) {
      setError("The starting point and destination must be different.");
      return;
    }

    setLoading(true);

    try {
      const response = await api.post("/route-recommendation/recommend", {
        startLocation,
        endLocation,
      });

      if (!response?.recommendedRoute) {
        throw new Error("The server returned no recommended route.");
      }

      setResult(response);
    } catch (err) {
      setError(err.message || "Unable to calculate a route. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setStartLocation("");
    setEndLocation("");
    setResult(null);
    setError("");
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h2 className="page-title">Route Recommendation</h2>
        <p className="page-description">
          Find an available route between two traffic locations, prioritizing
          lower congestion and then shorter estimated travel time.
        </p>
      </div>

      <section className="card route-search-card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Plan a Route</h3>
            <p className="card-subtitle">
              Choose your origin and destination to compare available routes.
            </p>
          </div>
        </div>

        <div className="card-body">
          {locationsError && (
            <div className="alert-banner alert-danger" role="alert">
              <div>
                <strong>Could not load locations.</strong> {locationsError}
                <button
                  type="button"
                  className="btn-refresh"
                  onClick={() => setLocationsRefreshIndex((current) => current + 1)}
                  disabled={locationsLoading}
                >
                  Retry loading locations
                </button>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="route-search-form">
            <div className="form-group">
              <label className="form-label" htmlFor="route-start">
                Starting location
              </label>
              <select
                id="route-start"
                className="form-input"
                value={startLocation}
                onChange={(event) => setStartLocation(event.target.value)}
                disabled={locationsLoading || locations.length === 0 || loading}
                required
              >
                <option value="">
                  {locationsLoading ? "Loading locations..." : "Choose origin"}
                </option>
                {locations.map((location) => (
                  <option key={location._id} value={location._id}>
                    {location.name} — {location.area}
                  </option>
                ))}
              </select>
            </div>

            <div className="route-direction-icon" aria-hidden="true">→</div>

            <div className="form-group">
              <label className="form-label" htmlFor="route-end">
                Destination
              </label>
              <select
                id="route-end"
                className="form-input"
                value={endLocation}
                onChange={(event) => setEndLocation(event.target.value)}
                disabled={locationsLoading || locations.length === 0 || loading}
                required
              >
                <option value="">Choose destination</option>
                {locations.map((location) => (
                  <option key={location._id} value={location._id}>
                    {location.name} — {location.area}
                  </option>
                ))}
              </select>
            </div>

            <div className="route-form-actions">
              <button
                type="submit"
                className="btn-primary"
                disabled={
                  loading ||
                  locationsLoading ||
                  locations.length < 2 ||
                  !startLocation ||
                  !endLocation
                }
              >
                {loading ? "Finding route..." : "Find Best Route"}
              </button>
              <button
                type="button"
                className="route-reset-button"
                onClick={handleReset}
                disabled={loading}
              >
                Reset
              </button>
            </div>
          </form>

          {!locationsLoading && !locationsError && locations.length < 2 && (
            <p className="route-helper-text">
              At least two active traffic locations are needed to plan a route.
            </p>
          )}
        </div>
      </section>

      {error && (
        <div className="alert-banner alert-danger route-feedback" role="alert">
          <div>{error}</div>
        </div>
      )}

      {loading && (
        <div className="card loading-card route-feedback" role="status">
          <div className="auth-loading-spinner" />
          <p>Comparing available routes...</p>
        </div>
      )}

      {result && !loading && (
        <section className="route-results-section" aria-live="polite">
          <div className="route-results-heading">
            <div>
              <h3 className="card-title">Your Route Results</h3>
              <p className="card-subtitle">
                {result.alternatives?.length || 0} alternative route(s) found
              </p>
            </div>
          </div>

          <div className="route-reason-card">
            <strong>Why this route?</strong>
            <p>{result.reason || "This is the best route returned by the system."}</p>
          </div>

          <RouteCard route={result.recommendedRoute} recommended />

          {Array.isArray(result.alternatives) && result.alternatives.length > 0 && (
            <div className="route-alternatives">
              <h3 className="card-title">Alternative Routes</h3>
              <div className="route-alternatives-grid">
                {result.alternatives.map((route, index) => (
                  <RouteCard
                    key={route.routeId || `${route.name}-${index}`}
                    route={route}
                  />
                ))}
              </div>
            </div>
          )}

          {Array.isArray(result.alternatives) && result.alternatives.length === 0 && (
            <p className="empty-state-text route-feedback">
              No alternative routes are available for this journey.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

export default RouteRecommendation;
