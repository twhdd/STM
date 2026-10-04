import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="card">
      <div className="not-found-container">
        <div className="not-found-code">404</div>
        <h2 className="page-title">Page Not Found</h2>
        <p className="page-description">
          The page or route you are looking for does not exist in the STM Portal.
        </p>
        <Link to="/" className="btn-primary">
          ← Return to Dashboard
        </Link>
      </div>
    </div>
  );
}

export default NotFound;
