import { MeasurementRuntime } from "./components/MeasurementRuntime";
const Partners = lazy(() => import("./pages/Partners"));
const PartnerDashboard = lazy(() => import("./pages/PartnerDashboard"));
import { PartnerReferralTracker } from "./components/PartnerReferralTracker";
const RenewalCheckout = lazy(() => import("./pages/RenewalCheckout"));
const SquareCheckout = lazy(() => import("./pages/SquareCheckout"));
import { lazy, Suspense, useEffect, useRef } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { AccountModeProvider } from "@/contexts/AccountModeContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Index from "./pages/Index";
const Auth = lazy(() => import("./pages/Auth"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Contact = lazy(() => import("./pages/Contact"));
const Fleet = lazy(() => import("./pages/Fleet"));
const VehicleDetail = lazy(() => import("./pages/VehicleDetail"));
const Booking = lazy(() => import("./pages/Booking"));
const BookingSuccess = lazy(() => import("./pages/BookingSuccess"));
const BookingCancel = lazy(() => import("./pages/BookingCancel"));
const PayPalReturn = lazy(() => import("./pages/PayPalReturn"));
const PaymentCheckout = lazy(() => import("./pages/PaymentCheckout"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const HostDashboard = lazy(() => import("./pages/HostDashboard"));
const GuestDashboard = lazy(() => import("./pages/GuestDashboard"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const OperationsDashboard = lazy(() => import("./pages/OperationsDashboard"));
const OperationsTripReceipt = lazy(() => import("./pages/OperationsTripReceipt"));
const Terms = lazy(() => import("./pages/Terms"));
const HouseRules = lazy(() => import("./pages/HouseRules"));
const BookingRentalAgreement = lazy(() => import("./pages/BookingRentalAgreement"));
const DriverEligibility = lazy(() => import("./pages/DriverEligibility"));
import TripReceipt from "@/pages/TripReceipt";

const BecomeHost = lazy(() => import("./pages/BecomeHost"));
import NotFound from "./pages/NotFound";

const RentalGuide = lazy(() => import("./pages/RentalGuide"));

const queryClient = new QueryClient();

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

const MetaRoutePageViewTracker = () => {
  const location = useLocation();
  const isFirstRoute = useRef(true);

  useEffect(() => {
    if (isFirstRoute.current) {
      isFirstRoute.current = false;
      return;
    }

    if (typeof window.fbq === "function") {
      window.fbq("track", "PageView");
    }
  }, [location.pathname]);

  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <LanguageProvider>
      <AuthProvider>
        <AccountModeProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <MetaRoutePageViewTracker />
            <PartnerReferralTracker />
            <MeasurementRuntime />
            <Suspense fallback={<div role="status" className="min-h-screen bg-black px-6 pt-36 text-center text-white">Loading ZONYX…</div>}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/partners" element={<Partners />} />
              <Route path="/partners/dashboard" element={<ProtectedRoute><PartnerDashboard /></ProtectedRoute>} />
              <Route path="/tesla-rental-miami" element={<RentalGuide />} />
              <Route path="/long-term-rentals" element={<RentalGuide />} />
              <Route path="/fleet" element={<Fleet />} />
              <Route path="/vehicle/:vehicleReference" element={<VehicleDetail />} />
              <Route path="/booking/:id" element={<Booking />} />
              <Route path="/booking/confirmed" element={<BookingSuccess />} />
              <Route path="/booking/success" element={<BookingSuccess />} />
              <Route path="/booking/renewal" element={<RenewalCheckout />} />
              <Route path="/booking/square" element={<SquareCheckout />} />
              {(import.meta.env.VITE_PAYPAL_INTERNAL_CHECKOUT_ENABLED === "true" || import.meta.env.VITE_PAYPAL_CUSTOMER_CHECKOUT_ENABLED === "true") && <Route path="/booking/payment" element={<PaymentCheckout />} />}
              <Route path="/booking/cancel" element={<BookingCancel />} />
              {(import.meta.env.VITE_PAYPAL_INTERNAL_CHECKOUT_ENABLED === "true" || (import.meta.env.VITE_PAYPAL_CUSTOMER_CHECKOUT_ENABLED === "true" && import.meta.env.VITE_PAYPAL_STANDARD_CHECKOUT_ENABLED === "true")) && <Route path="/booking/paypal/return" element={<PayPalReturn />} />}
              <Route path="/terms" element={<Terms />} />
              <Route path="/house-rules" element={<HouseRules />} />
              <Route path="/booking/:bookingId/agreement" element={<ProtectedRoute><BookingRentalAgreement /></ProtectedRoute>} />
              <Route path="/driver-eligibility" element={<DriverEligibility />} />
              <Route path="/trip/:id/receipt" element={<ProtectedRoute><TripReceipt /></ProtectedRoute>} />
              <Route path="/operations/trip/:id/receipt" element={<ProtectedRoute><OperationsTripReceipt /></ProtectedRoute>} />

              <Route path="/auth" element={<Auth />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/become-host" element={<BecomeHost />} />
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/host-dashboard"
                element={
                  <ProtectedRoute>
                    <HostDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/guest-dashboard"
                element={
                  <ProtectedRoute>
                    <GuestDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/operations-dashboard"
                element={<ProtectedRoute><OperationsDashboard /></ProtectedRoute>}
              />
              <Route
                path="/admin-dashboard"
                element={
                  <ProtectedRoute>
                    <AdminDashboard />
                  </ProtectedRoute>
                }
              />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
          </BrowserRouter>
        </TooltipProvider>
        </AccountModeProvider>
      </AuthProvider>
    </LanguageProvider>
  </QueryClientProvider>
);

export default App;
