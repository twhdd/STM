export function withPageQuery(path, { page, limit, ...filters } = {}) {
  const entries = [
    ["page", page],
    ["limit", limit],
    ...Object.keys(filters)
      .sort()
      .map((key) => [key, filters[key]]),
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");

  if (entries.length === 0) return path;

  return `${path}?${entries
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join("&")}`;
}

const isCount = (value, minimum) => Number.isInteger(value) && value >= minimum;

export function readPagination(response, fallbackLength = 0) {
  const candidate = response?.pagination;

  if (
    candidate &&
    isCount(candidate.page, 1) &&
    isCount(candidate.limit, 1) &&
    isCount(candidate.total, 0) &&
    isCount(candidate.totalPages, 0)
  ) {
    const { page, limit, total, totalPages } = candidate;
    return { page, limit, total, totalPages };
  }

  return {
    page: 1,
    limit: Math.max(1, fallbackLength),
    total: fallbackLength,
    totalPages: fallbackLength > 0 ? 1 : 0,
  };
}

export function describePageRange({ page, limit, total }) {
  if (total === 0) return "No records";

  const start = (page - 1) * limit + 1;
  if (start > total) return `No records on this page (${total} total)`;

  return `Showing ${start}–${Math.min(page * limit, total)} of ${total}`;
}

export function clampPage(page, totalPages) {
  if (!Number.isInteger(page) || page < 1) return 1;
  return Math.min(page, Math.max(1, totalPages || 0));
}
