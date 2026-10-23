function formatDuration(ms) {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(dateStr) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function JobStatusCard({ job, onRefresh, refreshing }) {
  if (!job) return null;

  const isQueued = job.status === "QUEUED";
  const isProcessing = job.status === "PROCESSING";
  const isCompleted = job.status === "COMPLETED";
  const isFailed = job.status === "FAILED";

  const getBadgeClass = () => {
    if (isQueued) return "cv-badge-queued";
    if (isProcessing) return "cv-badge-processing";
    if (isCompleted) return "cv-badge-completed";
    return "cv-badge-failed";
  };

  return (
    <div className="card">
      <div className="cv-status-header">
        <div>
          <span style={{ fontSize: "12px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Active Analysis Job
          </span>
          <h3 style={{ fontSize: "18px", fontWeight: "600", marginTop: "2px" }}>
            {job.originalFilename || "Traffic Video"}
          </h3>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span className={`cv-badge ${getBadgeClass()}`}>
            {(isQueued || isProcessing) && <span className="cv-pulse-dot" />}
            {job.status}
          </span>
          <button
            type="button"
            className="btn-secondary"
            onClick={onRefresh}
            disabled={refreshing}
            style={{ padding: "4px 10px", fontSize: "12px" }}
            aria-label="Refresh job status"
          >
            {refreshing ? "Refreshing..." : "↻ Refresh"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", fontSize: "13px" }}>
        <div>
          <span style={{ color: "var(--text-muted)" }}>Job ID: </span>
          <code style={{ fontSize: "12px" }}>{job.id || job._id}</code>
        </div>
        <div>
          <span style={{ color: "var(--text-muted)" }}>Submitted At: </span>
          <span>{formatTime(job.createdAt)}</span>
        </div>
        <div>
          <span style={{ color: "var(--text-muted)" }}>Processing Duration: </span>
          <span>{formatDuration(job.processingDurationMs)}</span>
        </div>
        <div>
          <span style={{ color: "var(--text-muted)" }}>Attempts: </span>
          <span>{job.attempts ?? 1}</span>
        </div>
      </div>

      {isProcessing && (
        <div style={{ marginTop: "16px", padding: "12px", background: "var(--color-primary-light)", borderRadius: "var(--radius-sm)", display: "flex", alignItems: "center", gap: "10px", fontSize: "13px", color: "var(--color-primary)" }}>
          <div className="auth-loading-spinner" style={{ width: "16px", height: "16px", borderWidth: "2px" }}></div>
          <span>Deep learning model is currently processing frames and extracting detections...</span>
        </div>
      )}

      {isQueued && (
        <div style={{ marginTop: "16px", padding: "12px", background: "var(--color-warning-light)", borderRadius: "var(--radius-sm)", fontSize: "13px", color: "#92400e" }}>
          <span>Job is in the processing queue. It will begin automatically when a worker slot is available.</span>
        </div>
      )}

      {isFailed && (
        <div className="alert-banner alert-danger" style={{ marginTop: "16px" }}>
          <span className="alert-icon">⚠️</span>
          <div>
            <strong>Processing Failed ({job.error?.code || "UNKNOWN"}): </strong>
            <span>{job.error?.message || "An error occurred during video processing."}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default JobStatusCard;
