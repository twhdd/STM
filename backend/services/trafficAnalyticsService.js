const TrafficMeasurement = require("../models/TrafficMeasurement");
const CongestionEvent = require("../models/CongestionEvent");
const TrafficAlert = require("../models/TrafficAlert");

// Generate traffic analytics with database-side aggregation, so the cost does
// not depend on loading every stored measurement into memory.
const getTrafficAnalytics = async () => {
  const [totalsResult, densityCounts, totalCongestionEvents, activeAlerts] =
    await Promise.all([
      TrafficMeasurement.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            totalVehicles: { $sum: "$vehicleCount" },
            totalSpeed: { $sum: "$averageSpeed" },
          },
        },
      ]),
      TrafficMeasurement.aggregate([
        { $group: { _id: "$trafficDensity", n: { $sum: 1 } } },
      ]),
      CongestionEvent.countDocuments(),
      TrafficAlert.countDocuments({ status: "ACTIVE" }),
    ]);

  const totals = totalsResult[0];

  if (!totals || totals.total === 0) {
    return {
      totalMeasurements: 0,
      averageVehicleCount: 0,
      averageSpeed: 0,
      trafficDistribution: {},
      totalCongestionEvents,
      activeAlerts,
    };
  }

  const trafficDistribution = {
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
    SEVERE: 0,
  };

  densityCounts.forEach(({ _id, n }) => {
    if (Object.hasOwn(trafficDistribution, _id)) {
      trafficDistribution[_id] = n;
    }
  });

  return {
    totalMeasurements: totals.total,
    averageVehicleCount: Number(
      (totals.totalVehicles / totals.total).toFixed(2)
    ),
    averageSpeed: Number((totals.totalSpeed / totals.total).toFixed(2)),
    trafficDistribution,
    totalCongestionEvents,
    activeAlerts,
  };
};

module.exports = {
  getTrafficAnalytics,
};
