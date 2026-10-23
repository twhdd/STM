import { useState, useRef } from "react";
import { uploadVideo, validateVideoFile } from "../../services/trafficVisionService";

export function VideoUploadCard({ onJobCreated }) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [tracking, setTracking] = useState(true);
  const [annotatedVideo, setAnnotatedVideo] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState(null);
  const fileInputRef = useRef(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer?.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e) => {
    if (e.target?.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
  };

  const handleFileSelected = (file) => {
    setErrorMessage(null);
    const validation = validateVideoFile(file);
    if (!validation.valid) {
      setErrorMessage(validation.error);
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  };

  const handleClearFile = () => {
    setSelectedFile(null);
    setErrorMessage(null);
    setUploadProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedFile || uploading) return;

    setUploading(true);
    setUploadProgress(0);
    setErrorMessage(null);

    try {
      const response = await uploadVideo(
        selectedFile,
        { tracking, annotatedVideo },
        ({ percent }) => {
          setUploadProgress(percent);
        }
      );

      if (response?.job) {
        onJobCreated?.(response.job);
        handleClearFile();
      }
    } catch (err) {
      console.error("Upload failed:", err);
      setErrorMessage(err.message || "Failed to upload video.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h3 className="card-title">Video Analysis (AI Computer Vision)</h3>
        <p className="card-subtitle">
          Upload recorded traffic camera footage for vehicle detection, multi-object tracking, and telemetry analysis.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div
          className={`cv-dropzone ${dragActive ? "drag-active" : ""}`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          aria-label="Upload video file dropzone"
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileInputChange}
            accept=".mp4,.mov,.avi,.mkv,.webm,video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm"
            style={{ display: "none" }}
            aria-hidden="true"
          />
          <span className="cv-dropzone-icon" aria-hidden="true">
            📹
          </span>
          <div>
            <strong>Click to browse</strong> or drag and drop a traffic video here
          </div>
          <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            Supported formats: MP4, MOV, AVI, MKV, WebM (Max 500 MB)
          </p>
        </div>

        {selectedFile && (
          <div className="cv-file-details">
            <div>
              <strong>{selectedFile.name}</strong>{" "}
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
              </span>
            </div>
            {!uploading && (
              <button
                type="button"
                className="btn-secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  handleClearFile();
                }}
                style={{ padding: "4px 8px", fontSize: "12px" }}
              >
                Remove
              </button>
            )}
          </div>
        )}

        <div className="cv-options-row">
          <label className="cv-checkbox-label">
            <input
              type="checkbox"
              checked={tracking}
              onChange={(e) => setTracking(e.target.checked)}
              disabled={uploading}
            />
            <span>Enable Multi-Object Tracking</span>
            <small style={{ color: "var(--text-muted)", marginLeft: "4px" }}>
              (Produces unique track IDs and counts)
            </small>
          </label>

          <label className="cv-checkbox-label">
            <input
              type="checkbox"
              checked={annotatedVideo}
              onChange={(e) => setAnnotatedVideo(e.target.checked)}
              disabled={uploading}
            />
            <span>Generate Annotated Video</span>
            <small style={{ color: "var(--text-muted)", marginLeft: "4px" }}>
              (Creates playback video with bounding boxes)
            </small>
          </label>
        </div>

        {uploading && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--text-secondary)" }}>
              <span>Uploading video to server...</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="cv-progress-bar-container">
              <div
                className="cv-progress-bar-fill"
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="alert-banner alert-danger" style={{ marginTop: "16px" }}>
            <span className="alert-icon">⚠️</span>
            <span>{errorMessage}</span>
          </div>
        )}

        <div style={{ marginTop: "20px" }}>
          <button
            type="submit"
            className="btn-primary"
            disabled={!selectedFile || uploading}
            style={{ width: "100%", padding: "10px 16px" }}
          >
            {uploading ? `Uploading Video (${uploadProgress}%)...` : "Submit Video for AI Processing"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default VideoUploadCard;
