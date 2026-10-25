const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_PAGE = 10000;

class QueryValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "QueryValidationError";
    this.statusCode = 400;
    this.code = code;
  }
}

function parseBoundedInteger(raw, fallback, name, max) {
  if (raw === undefined) return fallback;

  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) {
    throw new QueryValidationError(
      "INVALID_PAGINATION",
      `${name} must be a positive integer`
    );
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > max) {
    throw new QueryValidationError(
      "INVALID_PAGINATION",
      `${name} must be between 1 and ${max}`
    );
  }

  return value;
}

// Strict: malformed or out-of-range values are rejected, never silently clamped.
function parsePagination(query = {}) {
  const page = parseBoundedInteger(query.page, 1, "page", MAX_PAGE);
  const limit = parseBoundedInteger(query.limit, DEFAULT_LIMIT, "limit", MAX_LIMIT);

  return { page, limit, skip: (page - 1) * limit };
}

function buildPagination({ page, limit }, total) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

function parseEnumFilter(value, allowed, name) {
  if (value === undefined) return undefined;

  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new QueryValidationError(
      "INVALID_FILTER",
      `${name} must be one of: ${allowed.join(", ")}`
    );
  }

  return value;
}

function parseObjectIdFilter(value, name) {
  if (value === undefined) return undefined;

  if (typeof value !== "string" || !/^[a-f\d]{24}$/i.test(value)) {
    throw new QueryValidationError(
      "INVALID_FILTER",
      `${name} must be a valid ID`
    );
  }

  return value;
}

// Sends the 400 response for a validation error; returns false for any other error.
function sendQueryError(res, error) {
  if (error?.name !== "QueryValidationError") return false;

  res.status(error.statusCode).json({
    message: error.message,
    code: error.code,
  });
  return true;
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_PAGE,
  QueryValidationError,
  buildPagination,
  parseEnumFilter,
  parseObjectIdFilter,
  parsePagination,
  sendQueryError,
};
