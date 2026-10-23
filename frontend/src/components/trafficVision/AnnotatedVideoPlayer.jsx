import { useState, useEffect } from "react";
import {
  downloadResultJson,
  downloadAnnotatedVideo,
  getAnnotatedVideoBlobUrl,
} from "../../services/trafficVisionService";

export function AnnotatedVideoPlayer({ job }) {
  const [videoUrl, setVideoUrl] = useState(null);
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [videoError, setVideoError] = useState(null);
  const [downloadingJson, setDownloadingJson] = useState(false);
  const [downloadingVideo, setDownloadingVideo] = useState(false);
  const [actionError, setActionError] = useState(null);

  const jobId = job?.id || job?._id;
  const hasAnnotatedVideo = Boolean(job?.annotatedRequested);

  useEffect(() => {
    let active = true;
    let createdUrl = null;

    if (!jobId || job?.status !== "COMPLETED" || !hasAnnotatedVideo) {
      return undefined;
    }

    async function loadVideo() {
      try {
        setLoadingVideo(true);
        setVideoError(null);
        const url = await getAnnotatedVideoBlobUrl(jobId);
        if (active) {
          createdUrl = url;
          setVideoUrl(url);
        } else {
          window.URL.revokeObjectURL(url);
        }
      } catch (err) {
        if (active) {
          console.error("Failed to load video preview:", err);
          setVideoError(err.message || "Failed to load video stream.");
        }
      } finally {
        if (active) {
          setLoadingVideo(false);
        }
      }
    }

    // Defer loading so it does not trigger cascading renders in the synchronous effect body
    const timer = setTimeout(() => {
      loadVideo();
    }, 0);

    return () => {
      active = false;
      clearTimeout(timer);
      if (createdUrl) {
        window.URL.revokeObjectURL(createdUrl);
      }
    };
  }, [jobId, job?.status, hasAnnotatedVideo]);

  const handleDownloadJson = async () => {
    if (!jobId || downloadingJson) return;
    setDownloadingJson(true);
    setActionError(null);
    try {
      await downloadResultJson(jobId);
    } catch (err) {
      setActionError(err.message || "Failed to download JSON.");
    } finally {
      setDownloadingJson(false);
    }
  };

  const handleDownloadVideo = async () => {
    if (!jobId || downloadingVideo) return;
    setDownloadingVideo(true);
    setActionError(null);
    try {
      await downloadAnnotatedVideo(jobId, job?.originalFilename);
    } catch (err) {
      setActionError(err.message || "Failed to download video.");
    } finally {
      setDownloadingVideo(false);
    }
  };

  if (!job || job.status !== "COMPLETED") {
    return null;
  }

  return (
    <div className="card" style={{ marginTop: "24px" }}>
      <div className="card-header">
        <h3 className="card-title">Video Artifacts & Analysis Downloads</h3>
        <p className="card-subtitle">
          Export full bounding-box coordinates and view annotated detection playback.
        </p>
      </div>

      {actionError && (
        <div className="alert-banner alert-danger" style={{ marginBottom: "16px" }}>
          <span className="alert-icon">⚠️</span>
          <span>{actionError}</span>
        </div>
      )}

      {hasAnnotatedVideo ? (
        <div>
          <h4 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px" }}>
            Annotated Video Playback
          </h4>

          {loadingVideo && (
            <div style={{ padding: "32px", textAlign: "center", background: "var(--bg-subtle)", borderRadius: "var(--radius-md)" }}>
              <div className="auth-loading-spinner" style={{ margin: "0 auto 12px" }}></div>
              <p style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
                Buffering annotated video stream...
              </p>
            </div>
          )}

          {videoError && (
            <div className="alert-banner alert-warning">
              <span className="alert-icon">⚠️</span>
              <div>
                <strong>Video stream unavailable: </strong>
                <span>{videoError}</span>
              </div>
            </div>
          )}

          {videoUrl && !loadingVideo && (
            <div className="cv-video-player-container">
              <video
                controls
                src={videoUrl}
                playsInline
                preload="metadata"
                aria-label="Annotated traffic video playback"
              >
                Your browser does not support HTML5 video streaming.
              </video>
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: "16px", background: "var(--bg-subtle)", borderRadius: "var(--radius-sm)", marginBottom: "16px", fontSize: "13px", color: "var(--text-secondary)" }}>
          ℹ️ Annotated video was not requested when this job was submitted. You can still export the complete frame-by-frame JSON analysis data below.
        </div>
      )}

      {/* Action Buttons */}
      <div className="cv-actions-row">
        {hasAnnotatedVideo && (
          <button
            type="button"
            className="btn-secondary"
            onClick={handleDownloadVideo}
            disabled={downloadingVideo}
          >
            {downloadingVideo ? "Preparing Video..." : "📥 Download Annotated Video (.mp4)"}
          </button>
        )}

        <button
          type="button"
          className="btn-primary"
          onClick={handleDownloadJson}
          disabled={downloadingJson}
          style={{ padding: "8px 16px" }}
        >
          {downloadingJson ? "Downloading JSON..." : "📄 Download Analysis Results (.json)"}
        </button>
      </div>
    </div>
  );
}

export default AnnotatedVideoPlayer;
