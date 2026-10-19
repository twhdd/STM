
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

function getLocationId(location) {
  if (location && typeof location === "object" && location._id) {
    return String(location._id);
  }
  return typeof location === "string" ? location : "";
}

function uniqueLocations(routes, field) {
  const locations = new Map();
  for (const route of routes) {
    const location = route[field];
    const id = getLocationId(location);
    if (id) locations.set(id, location);
  }
  return [...locations.values()];
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
  const [routes, setRoutes] = useState([]);
  const [routesLoading, setRoutesLoading] = useState(true);
  const [routesError, setRoutesError] = useState("");
  const [routesRefreshIndex, setRoutesRefreshIndex] = useState(0);
  const [startLocation, setStartLocation] = useState("");
  const [endLocation, setEndLocation] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadRoutes() {
      setRoutesLoading(true);
      setRoutesError("");

      try {
        const response = await api.get("/routes");
        if (!Array.isArray(response?.routes)) {
          throw new Error("The server returned an invalid routes response.");
        }

        if (!cancelled) {
          setRoutes(response.routes);
        }
      } catch (err) {
        if (!cancelled) {
          setRoutesError(err.message || "Could not load stored routes.");
        }
      } finally {
        if (!cancelled) setRoutesLoading(false);
      }
    }

    loadRoutes();
    return () => {
      cancelled = true;
    };
  }, [routesRefreshIndex]);

  const availableRoutes = routes.filter((route) => route.status !== "BLOCKED");
  const startLocations = uniqueLocations(availableRoutes, "startLocation");
  const endLocations = uniqueLocations(
    availableRoutes.filter(
      (route) => getLocationId(route.startLocation) === startLocation
    ),
    "endLocation"
  );

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
      setError(err.message || "Unable to recommend a stored route. Please try again.");
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
          Compare predefined routes between locations. The backend ranks stored,
          non-blocked routes by traffic level and estimated travel time.
        </p>
      </div>

      <section className="card route-search-card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Plan a Route</h3>
            <p className="card-subtitle">
              Choose an origin and destination with a stored route.
            </p>
          </div>
        </div>

        <div className="card-body">
          {routesError && (
            <div className="alert-banner alert-danger" role="alert">
              <div>
                <strong>Could not load stored routes.</strong> {routesError}
                <button
                  type="button"
                  className="btn-refresh"
                  onClick={() => setRoutesRefreshIndex((current) => current + 1)}
                  disabled={routesLoading}
                >
                  Retry loading routes
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
                onChange={(event) => {
                  setStartLocation(event.target.value);
                  setEndLocation("");
                  setResult(null);
                  setError("");
                }}
                disabled={routesLoading || startLocations.length === 0 || loading}
                required
              >
                <option value="">
                  {routesLoading ? "Loading stored routes..." : "Choose origin"}
                </option>
                {startLocations.map((location) => (
                  <option key={getLocationId(location)} value={getLocationId(location)}>
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
                onChange={(event) => {
                  setEndLocation(event.target.value);
                  setResult(null);
                  setError("");
                }}
                disabled={routesLoading || !startLocation || endLocations.length === 0 || loading}
                required
              >
                <option value="">
                  {startLocation ? "Choose destination" : "Choose an origin first"}
                </option>
                {endLocations.map((location) => (
                  <option key={getLocationId(location)} value={getLocationId(location)}>
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
                  routesLoading ||
                  startLocations.length === 0 ||
                  endLocations.length === 0 ||
                  !startLocation ||
                  !endLocation
                }
              >
                {loading ? "Finding stored route..." : "Recommend Stored Route"}
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

          {!routesLoading && !routesError && startLocations.length === 0 && (
            <p className="route-helper-text">
              No non-blocked stored routes are available.
            </p>
          )}
          {!routesLoading && !routesError && startLocation && endLocations.length === 0 && (
            <p className="route-helper-text">
              No non-blocked stored destinations are available from the selected origin.
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
          <p>Comparing stored routes...</p>
        </div>
      )}

      {result && !loading && (
        <section className="route-results-section" aria-live="polite">
          <div className="route-results-heading">
            <div>
              <h3 className="card-title">Stored Route Results</h3>
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
