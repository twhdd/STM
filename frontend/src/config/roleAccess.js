const signalOptimizerRoles = Object.freeze(["ADMIN", "TRAFFIC_AUTHORITY"]);
const emergencyPriorityRoles = Object.freeze(["ADMIN", "EMERGENCY_SERVICE"]);
const reportReviewerRoles = Object.freeze([
  "ADMIN",
  "TRAFFIC_AUTHORITY",
  "TRAFFIC_POLICE",
]);
const staffReadRoles = Object.freeze([
  "ADMIN",
  "TRAFFIC_AUTHORITY",
  "TRAFFIC_POLICE",
  "EMERGENCY_SERVICE",
]);

export const roleAccess = Object.freeze({
  pages: Object.freeze({
    dashboard: null,
    trafficMonitoring: null,
    signalOptimization: signalOptimizerRoles,
    emergencyPriority: emergencyPriorityRoles,
    routeRecommendation: null,
    alertsAnalytics: null,
    citizenReporting: null,
  }),
  endpoints: Object.freeze({
    monitoringDevices: staffReadRoles,
    trafficSignals: staffReadRoles,
    emergencyVehicles: staffReadRoles,
  }),
  actions: Object.freeze({
    optimizeSignal: signalOptimizerRoles,
    activateEmergencyPriority: emergencyPriorityRoles,
    deactivateEmergencyPriority: emergencyPriorityRoles,
    generateTrafficAlert: signalOptimizerRoles,
    reviewCitizenReports: reportReviewerRoles,
  }),
});

export function hasRole(role, permittedRoles) {
  return Array.isArray(permittedRoles) && permittedRoles.includes(role);
}

export function canAccessPage(role, page) {
  if (!Object.hasOwn(roleAccess.pages, page)) return false;
  const permittedRoles = roleAccess.pages[page];
  return permittedRoles === null || hasRole(role, permittedRoles);
}
