export function AnalysisResultsView({ job }) {
  if (!job || job.status !== "COMPLETED" || !job.metrics) {
    return null;
  }

  const { detection, tracking, flow } = job.metrics;

  const perClassDetections = detection.perClassDetectionEvents || {};
  const perClassObj =
    perClassDetections instanceof Map
      ? Object.fromEntries(perClassDetections)
      : perClassDetections;

  const perClassTracking = tracking?.perClassTrackedVehicles || {};
  const perClassTrackingObj =
    perClassTracking instanceof Map
      ? Object.fromEntries(perClassTracking)
      : perClassTracking;

  return (
    <div className="card" style={{ marginTop: "24px" }}>
      <div className="card-header">
        <h3 className="card-title">Computer Vision Analysis Results</h3>
        <p className="card-subtitle">
          Validated vehicle telemetry extracted from neural network inference on recorded frames.
        </p>
      </div>

      {/* Safety & Isolation Disclaimer */}
      <div className="cv-disclaimer-banner" role="note">
        <strong>⚠️ Metric Distinction & Data Provenance Notice: </strong>
        <span>
          Detection events count individual bounding-box occurrences across frames and are distinct from unique tracked vehicles. Per system safety rules, CV telemetry is stored separately; no standard TrafficMeasurement documents were synthesized without verified physical device calibration.
        </span>
      </div>

      {/* Primary Detection Metrics Grid */}
      <div className="cv-metrics-grid">
        <div className="cv-metric-card">
          <div className="cv-metric-label">Total Detection Events</div>
          <div className="cv-metric-value">{detection.totalDetectionEvents ?? 0}</div>
          <div className="cv-metric-subtext">Cumulative across all frames</div>
        </div>

        <div className="cv-metric-card">
          <div className="cv-metric-label">Frames Processed</div>
          <div className="cv-metric-value">{detection.framesProcessed ?? 0}</div>
          <div className="cv-metric-subtext">Video frames analyzed</div>
        </div>

        <div className="cv-metric-card">
          <div className="cv-metric-label">Average Detections / Frame</div>
          <div className="cv-metric-value">
            {detection.averageDetectionsPerProcessedFrame !== undefined
              ? Number(detection.averageDetectionsPerProcessedFrame).toFixed(2)
              : "—"}
          </div>
          <div className="cv-metric-subtext">Mean vehicle density per frame</div>
        </div>

        <div className="cv-metric-card">
          <div className="cv-metric-label">Processing Performance</div>
          <div className="cv-metric-value">
            {detection.processingFps !== undefined
              ? `${Number(detection.processingFps).toFixed(1)} FPS`
              : "—"}
          </div>
          <div className="cv-metric-subtext">
            {detection.processingTimeSeconds !== undefined
              ? `Completed in ${Number(detection.processingTimeSeconds).toFixed(1)}s`
              : "Inference duration"}
          </div>
        </div>
      </div>

      {/* Vehicle Class Breakdown Table */}
      <h4 style={{ fontSize: "15px", fontWeight: "600", marginBottom: "8px" }}>
        Vehicle Classification Breakdown
      </h4>
      <table className="cv-table" aria-label="Vehicle Classification Breakdown Table">
        <thead>
          <tr>
            <th>Vehicle Class</th>
            <th>Detection Events</th>
            <th>Percentage of Detections</th>
            {tracking ? <th>Unique Tracked Vehicles</th> : null}
          </tr>
        </thead>
        <tbody>
          {["car", "bus", "truck", "motorcycle"].map((cls) => {
            const count = perClassObj[cls] ?? 0;
            const pct =
              detection.totalDetectionEvents > 0
                ? ((count / detection.totalDetectionEvents) * 100).toFixed(1)
                : 0;
            const trackCount = perClassTrackingObj[cls] ?? 0;

            return (
              <tr key={cls}>
                <td style={{ textTransform: "capitalize", fontWeight: "500" }}>{cls}</td>
                <td>{count}</td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "80px", height: "6px", background: "var(--bg-subtle)", borderRadius: "3px", overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: "var(--color-primary)" }}></div>
                    </div>
                    <span>{pct}%</span>
                  </div>
                </td>
                {tracking ? <td><strong>{trackCount}</strong></td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Multi-Object Tracking Metrics */}
      <div style={{ marginTop: "24px", paddingTop: "16px", borderTop: "1px solid var(--border-color)" }}>
        <h4 style={{ fontSize: "15px", fontWeight: "600", marginBottom: "8px" }}>
          Multi-Object Vehicle Tracking
        </h4>
        {tracking ? (
          <div className="cv-metrics-grid" style={{ marginBottom: "12px" }}>
            <div className="cv-metric-card">
              <div className="cv-metric-label">Unique Tracked Vehicles</div>
              <div className="cv-metric-value" style={{ color: "var(--color-primary)" }}>
                {tracking.distinctObservedTrackIds ?? 0}
              </div>
              <div className="cv-metric-subtext">Unique trajectories assigned by tracker</div>
            </div>

            <div className="cv-metric-card">
              <div className="cv-metric-label">Active Tracks (End of Video)</div>
              <div className="cv-metric-value">{tracking.activeTracks ?? 0}</div>
              <div className="cv-metric-subtext">Vehicles in view in terminal frame</div>
            </div>
          </div>
        ) : (
          <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>
            Vehicle tracking was not enabled for this analysis run. Unique track counts are not available.
          </p>
        )}
      </div>

      {/* Directional Flow & Virtual Line Crossings */}
      {flow?.crossings && (
        <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid var(--border-color)" }}>
          <h4 style={{ fontSize: "15px", fontWeight: "600", marginBottom: "8px" }}>
            Directional Virtual Tripwire Crossings
          </h4>
          <div style={{ display: "flex", gap: "20px" }}>
            <div className="cv-metric-card" style={{ flex: 1 }}>
              <div className="cv-metric-label">Inbound Crossings</div>
              <div className="cv-metric-value">{flow.crossings.negativeToPositive ?? 0}</div>
            </div>
            <div className="cv-metric-card" style={{ flex: 1 }}>
              <div className="cv-metric-label">Outbound Crossings</div>
              <div className="cv-metric-value">{flow.crossings.positiveToNegative ?? 0}</div>
            </div>
          </div>
        </div>
      )}

      {/* Standard Traffic Measurement Isolation Note */}
      <div style={{ marginTop: "20px", padding: "12px", background: "var(--bg-subtle)", borderRadius: "var(--radius-sm)", fontSize: "12px", color: "var(--text-secondary)" }}>
        <strong>Database Mapping Status: </strong>
        <span>{job.measurementMapping || "0 standard traffic measurements created."}</span>
      </div>
    </div>
  );
}

export default AnalysisResultsView;
