import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/common/ProtectedRoute";
import AppLayout from "./components/layout/AppLayout";
import Login from "./pages/Login";
import Home from "./pages/Home";
import TrafficMonitoring from "./pages/TrafficMonitoring";
import SignalOptimization from "./pages/SignalOptimization";
import EmergencyPriority from "./pages/EmergencyPriority";
import RouteRecommendation from "./pages/RouteRecommendation";
import AlertsAnalytics from "./pages/AlertsAnalytics";
import CitizenReporting from "./pages/CitizenReporting";
import NotFound from "./pages/NotFound";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Route */}
          <Route path="/login" element={<Login />} />

          {/* Protected Application Shell */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Home />} />
            <Route path="traffic-monitoring" element={<TrafficMonitoring />} />
            <Route path="signal-optimization" element={<SignalOptimization />} />
            <Route path="emergency-priority" element={<EmergencyPriority />} />
            <Route path="route-recommendation" element={<RouteRecommendation />} />
            <Route path="alerts-analytics" element={<AlertsAnalytics />} />
            <Route path="citizen-reporting" element={<CitizenReporting />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
