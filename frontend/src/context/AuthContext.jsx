import { useState } from "react";
import { AuthContext } from "./auth-context";
import api from "../services/api";

export function AuthProvider({ children }) {
  // Synchronously initialize auth state from localStorage
  const [token, setToken] = useState(() => {
    try {
      return localStorage.getItem("stm_token") || null;
    } catch {
      return null;
    }
  });

  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem("stm_user");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  /**
   * Log in user with credentials
   * @param {string} email
   * @param {string} password
   * @returns {Promise<object>} response data
   */
  const login = async (email, password) => {
    const data = await api.post("/auth/login", { email, password });

    if (data.success && data.token && data.user) {
      setToken(data.token);
      setUser(data.user);
      localStorage.setItem("stm_token", data.token);
      localStorage.setItem("stm_user", JSON.stringify(data.user));
    }

    return data;
  };

  /**
   * Log out user and clear stored authentication
   */
  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem("stm_token");
    localStorage.removeItem("stm_user");
    localStorage.removeItem("token");
  };

  const value = {
    user,
    token,
    isAuthenticated: !!token && !!user,
    loading: false,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export default AuthProvider;
