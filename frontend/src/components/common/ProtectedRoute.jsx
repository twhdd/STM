import { Navigate, useLocation, Outlet } from "react-router-dom";
import { useAuth } from "../../context/useAuth";
import { canAccessPage } from "../../config/roleAccess";

export function ProtectedRoute({ children, requiredPage }) {
  const { isAuthenticated, loading, user } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="auth-loading-screen">
        <div className="auth-loading-spinner"></div>
        <p>Loading STM Portal...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requiredPage && !canAccessPage(user?.role, requiredPage)) {
    return <Navigate to="/" replace />;
  }

  return children ? children : <Outlet />;
}

export default ProtectedRoute;
