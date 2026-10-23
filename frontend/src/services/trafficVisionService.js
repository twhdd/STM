import api from "./api";

const SUPPORTED_EXTENSIONS = [".mp4", ".mov", ".avi", ".mkv", ".webm"];
const SUPPORTED_MIME_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/avi",
  "video/x-matroska",
  "video/webm",
];
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB

export function validateVideoFile(file) {
  if (!file) {
    return { valid: false, error: "Please select a video file to upload." };
  }

  const name = file.name || "";
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();

  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    return {
      valid: false,
      error: `Unsupported file extension (${ext}). Supported: ${SUPPORTED_EXTENSIONS.join(", ")}`,
    };
  }

  if (file.type && !SUPPORTED_MIME_TYPES.includes(file.type.toLowerCase())) {
    return {
      valid: false,
      error: `Unsupported MIME type (${file.type}). Supported types: MP4, QuickTime, AVI, MKV, WebM.`,
    };
  }

  if (file.size <= 0) {
    return { valid: false, error: "The selected video file is empty." };
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      valid: false,
      error: `Video exceeds the 500 MB upload size limit (${(file.size / (1024 * 1024)).toFixed(1)} MB).`,
    };
  }

  return { valid: true, error: null };
}

function getStoredToken() {
  try {
    return localStorage.getItem("stm_token");
  } catch {
    return null;
  }
}

export async function uploadVideo(
  file,
  { tracking = true, annotatedVideo = false, idempotencyKey } = {},
  onProgress
) {
  const validation = validateVideoFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const baseUrl = api.getBaseUrl();
  const queryParams = new URLSearchParams({
    tracking: String(tracking),
    annotatedVideo: String(annotatedVideo),
  });
  const url = `${baseUrl}/traffic-vision/jobs?${queryParams.toString()}`;
  const token = getStoredToken();
  const idempKey = idempotencyKey || (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now()));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);

    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
    xhr.setRequestHeader("X-File-Name", file.name);
    xhr.setRequestHeader("Idempotency-Key", idempKey);

    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress({ percent, loaded: event.loaded, total: event.total });
        }
      };
    }

    xhr.onload = () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = { message: xhr.responseText };
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        const message = data?.message || `Upload failed with HTTP status ${xhr.status}`;
        const error = new Error(message);
        error.status = xhr.status;
        error.data = data;
        reject(error);
      }
    };

    xhr.onerror = () => {
      reject(new Error("Network error during video upload. Check connection."));
    };

    xhr.onabort = () => {
      reject(new Error("Video upload was cancelled."));
    };

    xhr.send(file);
  });
}

export async function getJobs(limit = 20) {
  return api.get(`/traffic-vision/jobs?limit=${limit}`);
}

export async function getJobStatus(jobId) {
  return api.get(`/traffic-vision/jobs/${jobId}`);
}

export async function getJobResults(jobId) {
  return api.get(`/traffic-vision/jobs/${jobId}/results`);
}

export async function downloadResultJson(jobId) {
  const baseUrl = api.getBaseUrl();
  const token = getStoredToken();
  const response = await fetch(`${baseUrl}/traffic-vision/jobs/${jobId}/result-file`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    if (response.status === 410) {
      throw new Error("The analysis results file has expired and is no longer available.");
    }
    throw new Error(`Failed to download analysis JSON (${response.status})`);
  }

  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = downloadUrl;
  a.download = `analysis-${jobId}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(downloadUrl);
}

export async function downloadAnnotatedVideo(jobId, filename = "annotated.mp4") {
  const baseUrl = api.getBaseUrl();
  const token = getStoredToken();
  const response = await fetch(`${baseUrl}/traffic-vision/jobs/${jobId}/annotated-video`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    if (response.status === 410) {
      throw new Error("The annotated video file has expired per retention policy.");
    }
    throw new Error(`Failed to download annotated video (${response.status})`);
  }

  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = downloadUrl;
  a.download = filename.startsWith("annotated-") ? filename : `annotated-${filename}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(downloadUrl);
}

export async function getAnnotatedVideoBlobUrl(jobId) {
  const baseUrl = api.getBaseUrl();
  const token = getStoredToken();
  const response = await fetch(`${baseUrl}/traffic-vision/jobs/${jobId}/annotated-video`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    if (response.status === 410) {
      throw new Error("The annotated video has expired.");
    }
    throw new Error(`Unable to load annotated video stream (${response.status})`);
  }

  const blob = await response.blob();
  return window.URL.createObjectURL(blob);
}
