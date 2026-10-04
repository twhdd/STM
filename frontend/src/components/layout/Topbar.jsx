import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/useAuth";

const pageTitles = {
  "/": "Operations Dashboard",
  "/traffic-monitoring": "Traffic Monitoring & Congestion",
  "/signal-optimization": "Traffic Signal Optimization",
  "/emergency-priority": "Emergency Vehicle Priority",
  "/route-recommendation": "Dynamic Route Recommendation",
  "/alerts-analytics": "Traffic Alerts & Analytics",
  "/citizen-reporting": "Citizen Incident Reporting",
};

// Format role string nicely (e.g. TRAFFIC_POLICE -> Traffic Police)
function formatRole(role) {
  if (!role) return "User";
  return role
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

// Generate initials from full name
function getInitials(name) {
  if (!name) return "U";
  const parts = name.trim().split(" ");
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export function Topbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const currentTitle = pageTitles[location.pathname] || "STM Portal";

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="topbar-title-group">
          <span className="topbar-breadcrumb">STM / Control Center</span>
          <h1 className="topbar-heading">{currentTitle}</h1>
        </div>
      </div>

      <div className="topbar-right">
        <div className="system-badge">
          <span>●</span>
          <span>Traffic Network Active</span>
        </div>

        {user && (
          <div className="topbar-user-section">
            <div className="topbar-user-badge">
              <div className="user-avatar">{getInitials(user.fullName)}</div>
              <div className="user-info">
                <span className="user-name">{user.fullName || user.email}</span>
                <span className="user-role-badge">{formatRole(user.role)}</span>
              </div>
            </div>

            <button
              type="button"
              className="btn-logout"
              onClick={handleLogout}
              title="Sign Out"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span>Logout</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export default Topbar;
