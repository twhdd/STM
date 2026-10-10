/**
 * Shared API service for the backend's /api routes.
 */

function normalizeBaseUrl(value) {
  const baseUrl = new URL(value || "http://localhost:5000/api", window.location.origin);
  const path = baseUrl.pathname.replace(/\/+$/, "");

  if (!/\/api$/i.test(path)) {
    baseUrl.pathname = `${path}/api`;
  } else {
    baseUrl.pathname = path;
  }

  baseUrl.search = "";
  baseUrl.hash = "";
  return baseUrl.toString().replace(/\/$/, "");
}

const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
let lastUnauthorizedToken = null;

function getStoredToken() {
  try {
    return localStorage.getItem("stm_token");
  } catch {
    return null;
  }
}

function getRequestUrl(endpoint) {
  const path = String(endpoint).replace(/^\/+/, "").replace(/^api(?:\/|$)/i, "");
  return `${API_BASE_URL}/${path}`;
}

function getErrorMessage(data, status) {
  if (data && typeof data === "object" && typeof data.message === "string") {
    return data.message;
  }

  if (typeof data === "string" && data.trim()) {
    return data.trim();
  }

  return `Request failed with status ${status}`;
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function notifyUnauthorized(token) {
  if (!token || typeof window === "undefined") return;

  if (lastUnauthorizedToken !== token) {
    lastUnauthorizedToken = token;
    window.dispatchEvent(new Event("stm:unauthorized"));
  }
}

/**
 * Execute a request and return its parsed response body, or null for an empty
 * response. API errors retain the HTTP status and parsed response body.
 */
async function request(endpoint, options = {}) {
  const url = getRequestUrl(endpoint);
  const headers = new Headers(options.headers);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  const token = getStoredToken();
  if (token !== lastUnauthorizedToken) {
    lastUnauthorizedToken = null;
  }
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const config = { ...options, headers };
  if (config.body !== undefined && config.body !== null) {
    const isFormData = typeof FormData !== "undefined" && config.body instanceof FormData;
    const isBodyString = typeof config.body === "string";

    if (typeof config.body === "object" && !isFormData) {
      config.body = JSON.stringify(config.body);
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
    } else if (isBodyString && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }

  try {
    const response = await fetch(url, config);
    const data = await readResponseBody(response);

    if (!response.ok) {
      const error = new Error(getErrorMessage(data, response.status));
      error.name = "ApiError";
      error.status = response.status;
      error.data = data;

      if (response.status === 401) {
        notifyUnauthorized(token);
      }

      throw error;
    }

    return data;
  } catch (error) {
    if (error?.name === "ApiError") {
      throw error;
    }

    const apiError = new Error(
      error?.name === "AbortError"
        ? "The API request was cancelled."
        : "Unable to reach the API server. Check your connection and try again."
    );
    apiError.name = error?.name === "AbortError" ? "AbortError" : "NetworkError";
    apiError.cause = error;
    throw apiError;
  }
}

export const api = {
  get: (endpoint, options = {}) => request(endpoint, { ...options, method: "GET" }),
  post: (endpoint, body, options = {}) => request(endpoint, { ...options, method: "POST", body }),
  put: (endpoint, body, options = {}) => request(endpoint, { ...options, method: "PUT", body }),
  delete: (endpoint, options = {}) => request(endpoint, { ...options, method: "DELETE" }),
  request,
  getBaseUrl: () => API_BASE_URL,
};

export default api;
