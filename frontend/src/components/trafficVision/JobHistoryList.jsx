function formatDate(dateStr) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function JobHistoryList({ jobs, activeJobId, onSelectJob, loading }) {
  if (loading) {
    return (
      <div className="card" style={{ marginTop: "24px" }}>
        <div style={{ textAlign: "center", padding: "20px" }}>
          <div className="auth-loading-spinner" style={{ margin: "0 auto 8px" }}></div>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Loading recent video analysis jobs...</p>
        </div>
      </div>
    );
  }

  if (!jobs || jobs.length === 0) {
    return (
      <div className="card" style={{ marginTop: "24px" }}>
        <div className="card-header">
          <h3 className="card-title">Analysis History</h3>
        </div>
        <p style={{ fontSize: "13px", color: "var(--text-muted)", padding: "12px 0" }}>
          No previous video analysis jobs found. Upload a video above to begin your first analysis.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: "24px" }}>
      <div className="card-header">
        <h3 className="card-title">Recent Video Analyses</h3>
        <p className="card-subtitle">
          Select any prior video processing run to inspect its detections, metrics, and video playback.
        </p>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="cv-table" aria-label="Recent Video Analyses Table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Video Name</th>
              <th>Submitted</th>
              <th>Detections</th>
              <th>Unique Tracks</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => {
              const jId = j.id || j._id;
              const isActive = jId === activeJobId;
              const isQueued = j.status === "QUEUED";
              const isProcessing = j.status === "PROCESSING";
              const isCompleted = j.status === "COMPLETED";

              const badgeClass = isQueued
                ? "cv-badge-queued"
                : isProcessing
                ? "cv-badge-processing"
                : isCompleted
                ? "cv-badge-completed"
                : "cv-badge-failed";

              const totalDetections = j.metrics?.detection?.totalDetectionEvents ?? "—";
              const uniqueTracks = j.metrics?.tracking?.distinctObservedTrackIds ?? (j.tracking === false ? "Disabled" : "—");

              return (
                <tr
                  key={jId}
                  style={isActive ? { backgroundColor: "var(--color-primary-light)" } : {}}
                >
                  <td>
                    <span className={`cv-badge ${badgeClass}`}>
                      {(isQueued || isProcessing) && <span className="cv-pulse-dot" />}
                      {j.status}
                    </span>
                  </td>
                  <td>
                    <strong>{j.originalFilename}</strong>
                  </td>
                  <td>{formatDate(j.createdAt)}</td>
                  <td>{totalDetections}</td>
                  <td>{uniqueTracks}</td>
                  <td>
                    <button
                      type="button"
                      className={isActive ? "btn-primary" : "btn-secondary"}
                      onClick={() => onSelectJob?.(j)}
                      style={{ padding: "4px 10px", fontSize: "12px" }}
                      aria-label={`View analysis job ${j.originalFilename}`}
                    >
                      {isActive ? "Selected" : "View"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default JobHistoryList;
