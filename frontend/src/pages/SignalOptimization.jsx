import { useEffect, useState } from "react";
import api from "../services/api";
import { useAuth } from "../context/useAuth";
import { canAccessPage, hasRole, roleAccess } from "../config/roleAccess";
import "./SignalOptimization.css";

function getLocationName(location) {
  if (location && typeof location === "object") {
    return [location.name, location.area].filter(Boolean).join(" — ") || "Location unavailable";
  }
  return "Location unavailable";
}

function formatMeasuredAt(value) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString();
}

export function SignalOptimization() {
  const { user } = useAuth();
  const [signals, setSignals] = useState([]);
  const [measurements, setMeasurements] = useState([]);
  const [signalId, setSignalId] = useState("");
  const [measurementId, setMeasurementId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState(null);
  const [refreshIndex, setRefreshIndex] = useState(0);

  const canViewSignals = hasRole(user?.role, roleAccess.endpoints.trafficSignals);
  const canAccessOptimization = canAccessPage(user?.role, "signalOptimization");
  const canLoadOptimizationData = canViewSignals && canAccessOptimization;
  const canOptimize = hasRole(user?.role, roleAccess.actions.optimizeSignal);
  const selectedSignal = signals.find((signal) => signal._id === signalId);
  const selectedMeasurement = measurements.find(
    (measurement) => measurement._id === measurementId
  );

  useEffect(() => {
    let cancelled = false;

    async function loadOptions() {
      if (!canLoadOptimizationData) {
        setLoading(false);
        setLoadError("");
        return;
      }

      setLoading(true);
      setLoadError("");

      try {
        const [signalsResponse, measurementsResponse] = await Promise.all([
          api.get("/traffic-signals"),
          api.get("/traffic-measurements"),
        ]);

        if (!Array.isArray(signalsResponse?.signals)) {
          throw new Error("The server returned an invalid traffic signals response.");
        }
        if (!Array.isArray(measurementsResponse?.measurements)) {
          throw new Error("The server returned an invalid traffic measurements response.");
        }

        if (!cancelled) {
          setSignals(signalsResponse.signals);
          setMeasurements(measurementsResponse.measurements);
          setSignalId((current) =>
            signalsResponse.signals.some((signal) => signal._id === current)
              ? current
              : ""
          );
          setMeasurementId((current) =>
            measurementsResponse.measurements.some(
              (measurement) => measurement._id === current
            )
              ? current
              : ""
          );
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error.message || "Unable to load signal optimization data.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadOptions();
    return () => {
      cancelled = true;
    };
  }, [canLoadOptimizationData, refreshIndex]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting || !canOptimize || !signalId || !measurementId) return;

    setSubmitting(true);
    setSubmitError("");
    setResult(null);

    try {
      const response = await api.post("/signal-optimization/optimize", {
        signalId,
        measurementId,
      });

      if (
        !response?.signal ||
        !response?.measurement ||
        !response?.optimization ||
        typeof response.optimization.previousGreenTime !== "number" ||
        typeof response.optimization.newGreenTime !== "number" ||
        typeof response.message !== "string"
      ) {
        throw new Error("The server returned an invalid optimization response.");
      }

      setResult(response);
    } catch (error) {
      setSubmitError(error.message || "Unable to optimize the traffic signal.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h2 className="page-title">Signal Optimization</h2>
          <p className="page-description">
            Adjust signal green time using current traffic measurements.
          </p>
        </div>
        <div className="card loading-card" role="status">
          <div className="auth-loading-spinner" />
          <p>Loading traffic signals and measurements...</p>
        </div>
      </div>
    );
  }

  if (!canAccessOptimization) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h2 className="page-title">Signal Optimization</h2>
          <p className="page-description">
            Adjust signal green time using current traffic measurements.
          </p>
        </div>
        <section className="card">
          <div className="alert-banner alert-warning" role="note">
            Signal configuration and measurement data are available to staff roles only.
            Your account does not have permission to view this data.
          </div>
        </section>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h2 className="page-title">Signal Optimization</h2>
          <p className="page-description">
            Adjust signal green time using current traffic measurements.
          </p>
        </div>
        <section className="card">
          <div className="alert-banner alert-danger" role="alert">
            <span className="alert-icon" aria-hidden="true">⚠️</span>
            <div>
              <strong>Could not load optimization options.</strong> {loadError}
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
      </div>
    );
  }

  const noSignals = signals.length === 0;
  const noMeasurements = measurements.length === 0;

  return (
    <div className="page-container">
      <div className="page-header">
        <h2 className="page-title">Signal Optimization</h2>
        <p className="page-description">
          Adjust signal green time using current traffic measurements.
        </p>
      </div>

      <section className="card signal-optimization-card">
        <div className="card-header">
          <h3 className="card-title">Optimize a Traffic Signal</h3>
          <p className="card-subtitle">
            Choose an intersection signal and a measurement to calculate an updated green time.
          </p>
        </div>

        {(noSignals || noMeasurements) && (
          <div className="alert-banner alert-warning" role="status">
            <div>
              {noSignals && noMeasurements
                ? "No traffic signals or measurements are available."
                : noSignals
                  ? "No traffic signals are available."
                  : "No traffic measurements are available."}
            </div>
          </div>
        )}

        {!canOptimize && (
          <div className="alert-banner alert-warning" role="note">
            <div>
              Only administrators and traffic authorities can optimize signals. Your account
              does not have either role.
            </div>
          </div>
        )}

        <form className="signal-optimization-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="optimization-signal">
              Traffic signal
            </label>
            <select
              id="optimization-signal"
              className="form-input"
              value={signalId}
              onChange={(event) => {
                setSignalId(event.target.value);
                setResult(null);
                setSubmitError("");
              }}
              disabled={noSignals || submitting}
              required
            >
              <option value="">Choose a signal</option>
              {signals.map((signal) => (
                <option key={signal._id} value={signal._id}>
                  {signal.name} ({signal.signalId}) — {getLocationName(signal.location)}
                </option>
              ))}
            </select>
            {selectedSignal && (
              <span className="signal-optimization-hint">
                {getLocationName(selectedSignal.location)} · Current green time:{" "}
                {selectedSignal.greenTime} seconds · Status: {selectedSignal.status}
              </span>
            )}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="optimization-measurement">
              Traffic measurement
            </label>
            <select
              id="optimization-measurement"
              className="form-input"
              value={measurementId}
              onChange={(event) => {
                setMeasurementId(event.target.value);
                setResult(null);
                setSubmitError("");
              }}
              disabled={noMeasurements || submitting}
              required
            >
              <option value="">Choose a measurement</option>
              {measurements.map((measurement) => (
                <option key={measurement._id} value={measurement._id}>
                  {getLocationName(measurement.location)} — {measurement.vehicleCount} vehicles,{" "}
                  {measurement.averageSpeed} average speed, {measurement.trafficDensity} density
                </option>
              ))}
            </select>
            {selectedMeasurement && (
              <span className="signal-optimization-hint">
                {getLocationName(selectedMeasurement.location)} ·{" "}
                {selectedMeasurement.vehicleCount} vehicles ·{" "}
                {selectedMeasurement.averageSpeed} average speed ·{" "}
                {selectedMeasurement.trafficDensity} density ·{" "}
                {formatMeasuredAt(selectedMeasurement.measuredAt)}
              </span>
            )}
          </div>

          {submitError && (
            <div className="alert-banner alert-danger signal-optimization-feedback" role="alert">
              <div>{submitError}</div>
            </div>
          )}

          <div className="signal-optimization-actions">
            <button
              type="submit"
              className="btn-primary"
              disabled={
                submitting ||
                !canOptimize ||
                noSignals ||
                noMeasurements ||
                !signalId ||
                !measurementId
              }
            >
              {submitting ? "Optimizing..." : "Optimize Signal"}
            </button>
          </div>
        </form>

        {result && (
          <div className="alert-banner alert-success signal-optimization-result" role="status">
            <div>
              <strong>{result.message}</strong>
              <p>
                Green time changed from {result.optimization.previousGreenTime} seconds to{" "}
                {result.optimization.newGreenTime} seconds.
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default SignalOptimization;
