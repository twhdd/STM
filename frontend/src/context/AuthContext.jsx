import { useCallback, useEffect, useState } from "react";
import { AuthContext } from "./auth-context";
import api from "../services/api";

function getJwtExpiration(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const encodedPayload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(encodedPayload));
    return Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function clearPersistedSession() {
  try {
    localStorage.removeItem("stm_token");
    localStorage.removeItem("stm_user");
    localStorage.removeItem("token");
  } catch (error) {
    console.error("Unable to clear the saved authentication session:", error);
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        const storedToken = localStorage.getItem("stm_token") || localStorage.getItem("token");
        const storedUser = localStorage.getItem("stm_user");

        if (storedToken && storedUser) {
          JSON.parse(storedUser);
        }
      } catch (error) {
        console.error("Unable to read the saved authentication session:", error);
      }

      // There is no backend endpoint that verifies a restored bearer token.
      // Do not expose protected UI based only on client-controlled storage.
      clearPersistedSession();
      setLoading(false);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    clearPersistedSession();
  }, []);

  useEffect(() => {
    window.addEventListener("stm:unauthorized", logout);
    return () => window.removeEventListener("stm:unauthorized", logout);
  }, [logout]);

  useEffect(() => {
    if (!token) return undefined;

    const expiresAt = getJwtExpiration(token);
    const timeoutId = window.setTimeout(
      logout,
      expiresAt === null ? 0 : Math.max(0, expiresAt - Date.now())
    );
    return () => window.clearTimeout(timeoutId);
  }, [token, logout]);

  const login = async (email, password) => {
    const data = await api.post("/auth/login", { email, password });
    const expiresAt = typeof data?.token === "string" ? getJwtExpiration(data.token) : null;

    if (
      data?.success !== true ||
      expiresAt === null ||
      expiresAt <= Date.now() ||
      !data.user ||
      typeof data.user !== "object" ||
      typeof data.user.id !== "string" ||
      typeof data.user.email !== "string"
    ) {
      throw new Error(data?.message || "The server returned an invalid login response.");
    }

    try {
      localStorage.setItem("stm_token", data.token);
      localStorage.setItem("stm_user", JSON.stringify(data.user));
      localStorage.removeItem("token");
    } catch (error) {
      clearPersistedSession();
      const persistenceError = new Error(
        "Unable to save the sign-in session in browser storage."
      );
      persistenceError.cause = error;
      throw persistenceError;
    }

    setToken(data.token);
    setUser(data.user);
    return data;
  };

  const value = {
    user,
    token,
    isAuthenticated: !loading && !!token && !!user,
    loading,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export default AuthProvider;
