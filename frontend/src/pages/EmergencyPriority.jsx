import { useEffect, useRef, useState } from "react";
import api from "../services/api";
import { useAuth } from "../context/useAuth";
import { canAccessPage, hasRole, roleAccess } from "../config/roleAccess";
import "./EmergencyPriority.css";

function getLocationName(location) {
  if (!location || typeof location !== "object") return "Location details unavailable";
  return [location.name, location.area].filter(Boolean).join(" — ") || "Location details unavailable";
}

export function EmergencyPriority() {
  const { user } = useAuth();
  const [vehicles, setVehicles] = useState([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState(null);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const submittingRef = useRef(false);
  const canViewVehicles = hasRole(user?.role, roleAccess.endpoints.emergencyVehicles);
  const canAccessEmergencyPriority = canAccessPage(user?.role, "emergencyPriority");
  const canLoadEmergencyVehicles = canViewVehicles && canAccessEmergencyPriority;
  const canActivate = hasRole(user?.role, roleAccess.actions.activateEmergencyPriority);

  useEffect(() => {
    let cancelled = false;

    async function loadVehicles() {
      if (!canLoadEmergencyVehicles) {
        setLoading(false);
        setLoadError("");
        return;
      }

      setLoading(true);
      setLoadError("");

      try {
        const response = await api.get("/emergency-vehicles");
        if (!Array.isArray(response?.vehicles)) {
          throw new Error("The server returned an invalid emergency vehicles response.");
        }

        if (!cancelled) {
          setVehicles(response.vehicles);
          setSelectedVehicleId((current) =>
            response.vehicles.some((vehicle) => vehicle._id === current) ? current : ""
          );
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error.status === 403
              ? `Staff access is required to view emergency vehicles. ${error.message}`
              : error.message || "Unable to load emergency vehicles.";
          setLoadError(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadVehicles();
    return () => {
      cancelled = true;
    };
  }, [canLoadEmergencyVehicles, refreshIndex]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submittingRef.current || !canActivate || !selectedVehicleId) return;

    const selectedVehicle = vehicles.find(
      (vehicle) => vehicle._id === selectedVehicleId
    );
    if (
      !window.confirm(
        `Activate emergency priority for ${
          selectedVehicle?.vehicleId || "the selected vehicle"
        }? This sets the active signal at its current location to emergency priority.`
      )
    ) {
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError("");
    setResult(null);

    try {
      const response = await api.post("/emergency-priority/activate", {
        vehicleId: selectedVehicleId,
      });

      if (
        !response?.vehicle ||
        !response?.signal ||
        typeof response.message !== "string"
      ) {
        throw new Error("The server returned an invalid emergency priority response.");
      }

      setResult(response);
      setVehicles((current) =>
        current.map((vehicle) =>
          vehicle._id === selectedVehicleId
            ? { ...vehicle, priorityActive: response.vehicle.priorityActive }
            : vehicle
        )
      );
    } catch (error) {
      setSubmitError(
        error.status === 403
          ? `Your account is not authorized to activate emergency priority. ${
              error.message || "Only administrators and emergency service users may activate priority."
            }`
          : error.message || "Unable to activate emergency priority."
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h2 className="page-title">Emergency Priority</h2>
        <p className="page-description">
          Activate signal priority for an emergency vehicle at its current location.
        </p>
      </div>

      {!canAccessEmergencyPriority ? (
        <section className="card">
          <div className="alert-banner alert-warning" role="note">
            Emergency Priority is restricted to administrators and emergency service
            users. Your account does not have permission to access this page.
          </div>
        </section>
      ) : loading ? (
        <section className="card loading-card" role="status">
          <div className="auth-loading-spinner" />
          <p>Loading emergency vehicle records...</p>
        </section>
      ) : loadError ? (
        <section className="card">
          <div className="alert-banner alert-danger" role="alert">
            <span className="alert-icon" aria-hidden="true">⚠️</span>
            <div>
              <strong>Could not load emergency vehicles.</strong> {loadError}
            </div>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setRefreshIndex((current) => current + 1)}
          >
            Retry
          </button>
        </section>
      ) : vehicles.length === 0 ? (
        <section className="card">
          <div className="emergency-priority-empty">
            <h3>No emergency vehicles available</h3>
            <p>There are no emergency vehicle records to display.</p>
          </div>
        </section>
      ) : (
        <section className="card emergency-priority-card">
          <div className="card-header">
            <h3 className="card-title">Emergency Vehicles</h3>
            <p className="card-subtitle">
              Select a vehicle to activate priority at its current location.
            </p>
          </div>

          {!canActivate && (
            <div className="alert-banner alert-warning" role="note">
              <div>
                Only administrators and emergency service users can activate priority.
                Your account does not have either role.
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <fieldset className="emergency-vehicle-grid">
              <legend className="emergency-vehicle-grid-legend">Select a vehicle</legend>
              {vehicles.map((vehicle) => {
                const selected = vehicle._id === selectedVehicleId;
                return (
                  <label
                    className={`emergency-vehicle-option${selected ? " is-selected" : ""}`}
                    key={vehicle._id}
                  >
                    <input
                      type="radio"
                      name="emergency-vehicle"
                      value={vehicle._id}
                      checked={selected}
                      onChange={() => {
                        setSelectedVehicleId(vehicle._id);
                        setResult(null);
                        setSubmitError("");
                      }}
                      disabled={submitting}
                    />
                    <span className="emergency-vehicle-option-content">
                      <span className="emergency-vehicle-heading">
                        <strong>{vehicle.vehicleId}</strong>
                        <span
                          className={`emergency-priority-badge${
                            vehicle.priorityActive ? " is-active" : ""
                          }`}
                        >
                          {vehicle.priorityActive ? "Priority active" : "Priority inactive"}
                        </span>
                      </span>
                      <span className="emergency-vehicle-details">
                        <span>
                          <span className="emergency-vehicle-detail-label">Type</span>
                          <strong>{vehicle.vehicleType}</strong>
                        </span>
                        <span>
                          <span className="emergency-vehicle-detail-label">Status</span>
                          <strong>{vehicle.status}</strong>
                        </span>
                        <span className="emergency-vehicle-location">
                          <span className="emergency-vehicle-detail-label">Current location</span>
                          <strong>{getLocationName(vehicle.currentLocation)}</strong>
                        </span>
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            {submitError && (
              <div className="alert-banner alert-danger emergency-priority-feedback" role="alert">
                <div>{submitError}</div>
              </div>
            )}

            <div className="emergency-priority-actions">
              <button
                type="submit"
                className="btn-primary"
                disabled={submitting || !canActivate || !selectedVehicleId}
              >
                {submitting ? "Activating priority..." : "Activate Emergency Priority"}
              </button>
            </div>
          </form>

          {result && (
            <div className="alert-banner alert-success emergency-priority-result" role="status">
              <div className="emergency-priority-result-content">
                <strong>{result.message}</strong>
                <div className="emergency-priority-result-grid">
                  <div>
                    <span className="emergency-vehicle-detail-label">Vehicle</span>
                    <strong>
                      {result.vehicle.vehicleId} · {result.vehicle.vehicleType}
                    </strong>
                    <span>
                      Status: {result.vehicle.status} · Priority{" "}
                      {result.vehicle.priorityActive ? "active" : "inactive"}
                    </span>
                  </div>
                  <div>
                    <span className="emergency-vehicle-detail-label">Signal</span>
                    <strong>
                      {result.signal.name} ({result.signal.signalId})
                    </strong>
                    <span>
                      Phase: {result.signal.currentPhase} · Green time:{" "}
                      {result.signal.greenTime} seconds
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default EmergencyPriority;
