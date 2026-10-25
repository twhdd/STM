import { describePageRange } from "../../utils/pagination";
import "./Pager.css";

export function Pager({ pagination, onPageChange, disabled = false, label = "Pagination" }) {
  const { page, totalPages } = pagination;

  return (
    <nav className="pager" aria-label={label}>
      <span className="pager-summary" aria-live="polite">
        {describePageRange(pagination)}
      </span>
      {totalPages > 1 && (
        <span className="pager-controls">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onPageChange(page - 1)}
            disabled={disabled || page <= 1}
          >
            Previous
          </button>
          <span className="pager-position">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onPageChange(page + 1)}
            disabled={disabled || page >= totalPages}
          >
            Next
          </button>
        </span>
      )}
    </nav>
  );
}

export default Pager;
