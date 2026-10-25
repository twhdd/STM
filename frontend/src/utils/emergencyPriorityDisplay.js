export function formatActiveSince(activatedAt, { timeZone } = {}) {
  if (!activatedAt) return null;

  const date = new Date(activatedAt);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

export function applyPriorityChange(vehicles, vehicleId, { priorityActive, activatedAt }) {
  return vehicles.map((vehicle) =>
    vehicle._id === vehicleId
      ? { ...vehicle, priorityActive, activatedAt: priorityActive ? activatedAt : null }
      : vehicle
  );
}

const ERROR_MESSAGES = {
  PRIORITY_NOT_ACTIVE:
    "Priority is not active for this vehicle; it may already have been deactivated.",
  PRIORITY_ALREADY_ACTIVE: "Priority is already active for this vehicle.",
  SIGNAL_ALREADY_OVERRIDDEN:
    "Another emergency vehicle already holds priority at this signal.",
  NO_ACTIVE_SIGNAL: "There is no active traffic signal at this vehicle's location.",
  VEHICLE_INACTIVE: "This vehicle is inactive and cannot request priority.",
  SIGNAL_CHANGED: "The signal changed while priority was being set. Please try again.",
};

export function priorityErrorMessage(error, action) {
  const known = ERROR_MESSAGES[error?.data?.code];
  if (known) return known;

  if (error?.status === 403) {
    return `Your account is not authorized to ${action} emergency priority. ${
      error.message || "Only administrators and emergency service users may do this."
    }`;
  }

  return error?.message || `Unable to ${action} emergency priority.`;
}
