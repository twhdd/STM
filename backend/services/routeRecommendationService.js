const Route = require("../models/Route");

// Traffic levels ranked from best to worst
const trafficScore = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  SEVERE: 4,
};

// Recommend the best route between two locations
const recommendRoute = async (startLocation, endLocation) => {
  const routes = await Route.find({
    startLocation,
    endLocation,
    status: { $ne: "BLOCKED" },
  });

  if (routes.length === 0) {
    throw new Error("No available routes found");
  }

  // Sort routes by traffic level first, then estimated travel time
  routes.sort((a, b) => {
    const trafficDifference =
      trafficScore[a.trafficLevel] - trafficScore[b.trafficLevel];

    if (trafficDifference !== 0) {
      return trafficDifference;
    }

    return a.estimatedTime - b.estimatedTime;
  });

  const recommendedRoute = routes[0];

  return {
    recommendedRoute: {
      routeId: recommendedRoute.routeId,
      name: recommendedRoute.name,
      distance: recommendedRoute.distance,
      estimatedTime: recommendedRoute.estimatedTime,
      trafficLevel: recommendedRoute.trafficLevel,
      status: recommendedRoute.status,
    },
    alternatives: routes.slice(1).map((route) => ({
      routeId: route.routeId,
      name: route.name,
      distance: route.distance,
      estimatedTime: route.estimatedTime,
      trafficLevel: route.trafficLevel,
      status: route.status,
    })),
    reason: `Recommended because it has ${recommendedRoute.trafficLevel.toLowerCase()} traffic and an estimated travel time of ${recommendedRoute.estimatedTime} minutes.`,
  };
};

module.exports = {
  recommendRoute,
};
