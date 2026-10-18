import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/useAuth";
import api from "../services/api";
import { hasRole, roleAccess } from "../config/roleAccess";
import "./CitizenReporting.css";

const reviewActionsByStatus = {
  SUBMITTED: [["UNDER_REVIEW", "Start review"]],
  UNDER_REVIEW: [
    ["VERIFIED", "Verify"],
    ["RESOLVED", "Resolve"],
    ["REJECTED", "Reject"],
  ],
  VERIFIED: [
    ["RESOLVED", "Resolve"],
    ["REJECTED", "Reject"],
  ],
};

const reportTypes = [
  ["ACCIDENT", "Accident"],
  ["CONGESTION", "Congestion"],
  ["ROAD_BLOCKAGE", "Road blockage"],
  ["SIGNAL_ISSUE", "Signal issue"],
  ["OTHER", "Other"],
];

const severities = [
  ["LOW", "Low"],
  ["MEDIUM", "Medium"],
  ["HIGH", "High"],
];

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
    return [location.name, location.area].filter(Boolean).join(" — ") || "Location unavailable";
  }
  return "Location unavailable";
}

function getSeverityClass(severity) {
  if (severity === "HIGH") return "badge-danger";
  if (severity === "MEDIUM") return "badge-warning";
  if (severity === "LOW") return "badge-info";
  return "badge-neutral";
}

function getStatusClass(status) {
  if (status === "RESOLVED" || status === "VERIFIED") return "badge-success";
  if (status === "REJECTED") return "badge-danger";
  if (status === "UNDER_REVIEW") return "badge-info";
  if (status === "SUBMITTED") return "badge-warning";
  return "badge-neutral";
}

export function CitizenReporting() {
  const { user } = useAuth();
  const canReviewReports = hasRole(
    user?.role,
    roleAccess.actions.reviewCitizenReports
  );
  const [locations, setLocations] = useState([]);
  const [reports, setReports] = useState([]);
  const [locationId, setLocationId] = useState("");
  const [reportType, setReportType] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("MEDIUM");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitMessage, setSubmitMessage] = useState("");
  const submittingRef = useRef(false);
  const [reviewingReportId, setReviewingReportId] = useState("");
  const [reviewFeedback, setReviewFeedback] = useState(null);
  const reviewingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function loadReportingData() {
      setLoading(true);
      setLoadError("");

      try {
        const [locationsResponse, reportsResponse] = await Promise.all([
          api.get("/traffic-locations"),
          api.get("/citizen-reports"),
        ]);

        if (!Array.isArray(locationsResponse?.locations)) {
          throw new Error("The server returned an invalid traffic locations response.");
        }
        if (!Array.isArray(reportsResponse?.reports)) {
          throw new Error("The server returned an invalid citizen reports response.");
        }

        if (!cancelled) {
          setLocations(locationsResponse.locations);
          setReports(reportsResponse.reports);
          setLocationId((current) =>
            locationsResponse.locations.some((location) => location._id === current)
              ? current
              : ""
          );
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error.message || "Unable to load locations and citizen reports.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadReportingData();
    return () => {
      cancelled = true;
    };
  }, [refreshIndex]);

  function handleRefresh() {
    setLoading(true);
    setRefreshIndex((current) => current + 1);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submittingRef.current) return;

    if (!locationId || !reportType || !description.trim()) {
      setSubmitError("Select a location and report type, and enter a description.");
      setSubmitMessage("");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError("");
    setSubmitMessage("");

    try {
      const response = await api.post("/citizen-reports", {
        location: locationId,
        reportType,
        description: description.trim(),
        severity,
      });

      if (typeof response?.message !== "string") {
        throw new Error("The server returned an invalid report submission response.");
      }

      setSubmitMessage(response.message);
      setLocationId("");
      setReportType("");
      setDescription("");
      setSeverity("MEDIUM");
      handleRefresh();
    } catch (error) {
      setSubmitError(error.message || "Unable to submit your report.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function handleReview(report, status) {
    if (!canReviewReports || reviewingRef.current) return;

    reviewingRef.current = true;
    setReviewingReportId(report._id);
    setReviewFeedback(null);

    try {
      const response = await api.request(
        `/citizen-reports/${report._id}/review`,
        { method: "PATCH", body: { status } }
      );

      if (
        typeof response?.message !== "string" ||
        response.report?.status !== status
      ) {
        throw new Error("The server returned an invalid report review response.");
      }

      setReports((currentReports) =>
        currentReports.map((currentReport) =>
          currentReport._id === report._id
            ? {
                ...currentReport,
                status: response.report.status,
                reviewedAt: response.report.reviewedAt,
                updatedAt: response.report.updatedAt,
              }
            : currentReport
        )
      );
      setReviewFeedback({
        reportId: report._id,
        type: "success",
        message: response.message,
      });
    } catch (error) {
      setReviewFeedback({
        reportId: report._id,
        type: "error",
        message: error.message || "Unable to update this report.",
      });
    } finally {
      reviewingRef.current = false;
      setReviewingReportId("");
    }
  }

  if (loading) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h2 className="page-title">Citizen Reporting</h2>
          <p className="page-description">
            Submit a traffic incident report and follow its review status.
          </p>
        </div>
        <section className="card loading-card" role="status">
          <div className="auth-loading-spinner" />
          <p>Loading reporting locations and your visible reports...</p>
        </section>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h2 className="page-title">Citizen Reporting</h2>
          <p className="page-description">
            Submit a traffic incident report and follow its review status.
          </p>
        </div>
        <section className="card">
          <div className="alert-banner alert-danger" role="alert">
            <span className="alert-icon" aria-hidden="true">⚠️</span>
            <div>
              <strong>Could not load reporting data.</strong> {loadError}
            </div>
          </div>
          <button type="button" className="btn-primary" onClick={handleRefresh}>
            Retry
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="header-actions-row citizen-reporting-header">
          <div>
            <h2 className="page-title">Citizen Reporting</h2>
            <p className="page-description">
              Submit a traffic incident report and follow its review status.
            </p>
          </div>
          <button
            type="button"
            className="btn-refresh"
            onClick={handleRefresh}
            disabled={submitting}
            title="Refresh locations and visible reports"
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
      </div>

      <section className="card citizen-report-form-card">
        <div className="card-header">
          <h3 className="card-title">Submit a Traffic Report</h3>
          <p className="card-subtitle">
            Provide the location and details so the appropriate team can review it.
          </p>
        </div>

        {locations.length === 0 && (
          <div className="alert-banner alert-warning" role="status">
            No traffic locations are available. A report cannot be submitted until a location is available.
          </div>
        )}

        <form className="citizen-report-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="citizen-report-location">
              Location
            </label>
            <select
              id="citizen-report-location"
              className="form-input"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
              disabled={locations.length === 0 || submitting}
              required
            >
              <option value="">Choose a traffic location</option>
              {locations.map((location) => (
                <option key={location._id} value={location._id}>
                  {location.name} — {location.area}
                  {location.status ? ` (${location.status})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="citizen-report-type">
              Report type
            </label>
            <select
              id="citizen-report-type"
              className="form-input"
              value={reportType}
              onChange={(event) => setReportType(event.target.value)}
              disabled={submitting}
              required
            >
              <option value="">Choose a report type</option>
              {reportTypes.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div className="form-group citizen-report-description">
            <label className="form-label" htmlFor="citizen-report-description">
              Description
            </label>
            <textarea
              id="citizen-report-description"
              className="form-input citizen-report-textarea"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={5}
              placeholder="Describe what you observed..."
              disabled={submitting}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="citizen-report-severity">
              Severity
            </label>
            <select
              id="citizen-report-severity"
              className="form-input"
              value={severity}
              onChange={(event) => setSeverity(event.target.value)}
              disabled={submitting}
              required
            >
              {severities.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {submitError && (
            <div className="alert-banner alert-danger citizen-report-feedback" role="alert">
              {submitError}
            </div>
          )}
          {submitMessage && (
            <div className="alert-banner alert-success citizen-report-feedback" role="status">
              {submitMessage}
            </div>
          )}

          <div className="citizen-report-actions">
            <button
              type="submit"
              className="btn-primary"
              disabled={locations.length === 0 || submitting}
            >
              {submitting ? "Submitting report..." : "Submit Report"}
            </button>
          </div>
        </form>
      </section>

      <section className="card citizen-reports-card">
        <div className="card-header">
          <h3 className="card-title">Visible Reports</h3>
          <p className="card-subtitle">
            Reports available to your account, as determined by the server.
          </p>
        </div>
        {canReviewReports && (
          <p className="citizen-review-permission-note">
            Review actions are recorded by the server for each report.
          </p>
        )}
        {reports.length === 0 ? (
          <p className="empty-state-text">No reports are currently visible to your account.</p>
        ) : (
          <div className="citizen-report-list">
            {reports.map((report) => (
              <article className="citizen-report-item" key={report._id}>
                <div className="citizen-report-item-heading">
                  <div>
                    <h4>{report.reportType?.replaceAll("_", " ") || "Traffic report"}</h4>
                    <p>{getLocationName(report.location)}</p>
                    {canReviewReports && report.reportedBy && (
                      <p className="citizen-report-reporter">
                        Reported by:{" "}
                        {report.reportedBy.fullName || report.reportedBy.email || "Unknown user"}
                        {report.reportedBy.email && report.reportedBy.fullName
                          ? ` (${report.reportedBy.email})`
                          : ""}
                      </p>
                    )}
                  </div>
                  <div className="citizen-report-badges">
                    <span className={`badge ${getSeverityClass(report.severity)}`}>
                      {report.severity || "—"}
                    </span>
                    <span className={`badge ${getStatusClass(report.status)}`}>
                      {report.status?.replaceAll("_", " ") || "—"}
                    </span>
                  </div>
                </div>
                <p className="citizen-report-description-text">{report.description}</p>
                <div className="citizen-report-timestamps">
                  <span>ID: {report._id}</span>
                  <span>
                    Submitted: <time dateTime={report.createdAt || undefined}>
                      {formatDateTime(report.createdAt)}
                    </time>
                  </span>
                  <span>
                    Last updated: <time dateTime={report.updatedAt || undefined}>
                      {formatDateTime(report.updatedAt)}
                    </time>
                  </span>
                </div>
                {canReviewReports &&
                  (reviewActionsByStatus[report.status] || []).length > 0 && (
                    <div className="citizen-report-review-actions">
                      {reviewActionsByStatus[report.status].map(([status, label]) => (
                        <button
                          type="button"
                          className={`btn-primary${
                            status === "REJECTED" ? " citizen-review-reject" : ""
                          }`}
                          key={status}
                          onClick={() => handleReview(report, status)}
                          disabled={Boolean(reviewingReportId)}
                        >
                          {reviewingReportId === report._id
                            ? `Updating to ${label.toLowerCase()}...`
                            : label}
                        </button>
                      ))}
                    </div>
                  )}
                {reviewFeedback?.reportId === report._id && (
                  <div
                    className={`alert-banner ${
                      reviewFeedback.type === "success" ? "alert-success" : "alert-danger"
                    } citizen-review-feedback`}
                    role={reviewFeedback.type === "success" ? "status" : "alert"}
                  >
                    {reviewFeedback.message}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default CitizenReporting;
