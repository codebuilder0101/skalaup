import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import Index from "./pages/Index";
import AuthPage from "./pages/AuthPage";
import RestaurantsPage from "./pages/RestaurantsPage";
import FreelancersPage from "./pages/FreelancersPage";
import ProfilePage from "./pages/ProfilePage";
import ApprovalsPage from "./pages/ApprovalsPage";
import SettingsPage from "./pages/SettingsPage";
import SchedulingPage from "./pages/SchedulingPage";
import AvailabilityPage from "./pages/AvailabilityPage";
import DemandPage from "./pages/DemandPage";
import CheckinPage from "./pages/CheckinPage";
import TodayPage from "./pages/TodayPage";
import AttendancePage from "./pages/AttendancePage";
import MySchedulePage from "./pages/MySchedulePage";
import VagasPage from "./pages/VagasPage";
import PerformancePage from "./pages/PerformancePage";
import SwapsPage from "./pages/SwapsPage";
import FeedbackPage from "./pages/FeedbackPage";
import FinancialPage from "./pages/FinancialPage";
import PlaceholderPage from "./pages/PlaceholderPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />

            <Route path="/dashboard" element={<ProtectedRoute pathKey="/dashboard"><Index /></ProtectedRoute>} />
            <Route path="/restaurants" element={<ProtectedRoute pathKey="/restaurants"><RestaurantsPage /></ProtectedRoute>} />
            <Route path="/freelancers" element={<ProtectedRoute pathKey="/freelancers"><FreelancersPage /></ProtectedRoute>} />
            <Route path="/approvals" element={<ProtectedRoute pathKey="/approvals"><ApprovalsPage /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute pathKey="/profile"><ProfilePage /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute pathKey="/settings"><SettingsPage /></ProtectedRoute>} />

            <Route path="/scheduling" element={<ProtectedRoute pathKey="/scheduling"><SchedulingPage /></ProtectedRoute>} />
            <Route path="/demand" element={<ProtectedRoute pathKey="/demand"><DemandPage /></ProtectedRoute>} />

            <Route path="/availability" element={<ProtectedRoute pathKey="/availability"><AvailabilityPage /></ProtectedRoute>} />
            <Route path="/checkin" element={<ProtectedRoute pathKey="/checkin"><CheckinPage /></ProtectedRoute>} />
            <Route path="/attendance" element={<ProtectedRoute pathKey="/attendance"><AttendancePage /></ProtectedRoute>} />

            {/* Modules with real screens coming next — routed placeholders for now */}
            <Route path="/swaps" element={<ProtectedRoute pathKey="/swaps"><SwapsPage /></ProtectedRoute>} />
            <Route path="/feedback" element={<ProtectedRoute pathKey="/feedback"><FeedbackPage /></ProtectedRoute>} />
            <Route path="/performance" element={<ProtectedRoute pathKey="/performance"><PerformancePage /></ProtectedRoute>} />
            <Route path="/financial" element={<ProtectedRoute pathKey="/financial"><FinancialPage /></ProtectedRoute>} />
            <Route path="/notifications" element={<ProtectedRoute pathKey="/notifications"><PlaceholderPage titleKey="nav.notifications" descriptionKey="skala.placeholder.notifications" /></ProtectedRoute>} />
            <Route path="/my-schedule" element={<ProtectedRoute pathKey="/my-schedule"><MySchedulePage /></ProtectedRoute>} />
            <Route path="/vagas" element={<ProtectedRoute pathKey="/vagas"><VagasPage /></ProtectedRoute>} />
            <Route path="/today" element={<ProtectedRoute pathKey="/today"><TodayPage /></ProtectedRoute>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
