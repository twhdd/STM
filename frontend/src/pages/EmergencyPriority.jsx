export function EmergencyPriority() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h2 className="page-title">Emergency Priority</h2>
        <p className="page-description">
          Emergency vehicle detection, automated green wave preemption, and priority corridor tracking.
        </p>
      </div>

      <div className="card">
        <div className="placeholder-box">
          <div className="placeholder-icon">🚑</div>
          <h3 className="placeholder-title">Emergency Vehicle Preemption</h3>
          <p className="placeholder-desc">
            Active emergency vehicle tracking, route preemption status, and corridor clearing controls.
          </p>
          <span className="placeholder-badge">Module implementation coming in subsequent task</span>
        </div>
      </div>
    </div>
  );
}

export default EmergencyPriority;
