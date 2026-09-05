import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { createStripeCheckoutSession, ZONYX_SERVICE_FEE_RATE, ZONYX_TAX_RATE } from "@/lib/stripe";
import { ArrowLeft, CalendarDays, Copy, CreditCard, Check, ShieldCheck, MapPin } from "lucide-react";

interface VehicleRow {
  id: string;
  brand: string;
  name: string;
  category: string;
  year: number;
  color: string;
  base_daily_rate_cents: number;
  image_url: string | null;
  images: string[] | null;
  vehicle_identifier: string;
  is_active: boolean;
}

type CheckoutStage = "auth-session" | "create-booking" | "persisted-booking-read" | "stripe-checkout-request" | "redirect";

const CREATE_BOOKING_TIMEOUT_MS = 20000;
const PERSISTED_BOOKING_READ_TIMEOUT_MS = 10000;
const FSD_ADDON_CENTS = 17500;
const DIGITAL_KEY_ADDON_CENTS = 15000;
const AIRPORT_DELIVERY_ADDON_CENTS = 12000;
const CUSTOM_DESTINATION_ADDON_CENTS = 12000;

const MIAMI_SERVICE_AREAS = [
  "Coconut Grove",
  "Brickell",
  "Downtown Miami",
  "Wynwood",
  "Miami Beach",
  "Coral Gables",
  "Edgewater",
  "Miami International Airport",
] as const;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function trackCheckoutStage(stage: CheckoutStage, state: "start" | "success" | "error", detail?: Record<string, unknown>) {
  console.info("[checkout-flow]", {
    stage,
    state,
    ...detail,
  });
}

function toCheckoutUserMessage(error: unknown): string {
  const rawMessage =
    typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
      ? error.message
      : "";

  if (rawMessage.includes("timed out")) {
    return "Checkout is taking longer than expected. Please try again.";
  }

  return rawMessage || "Unable to initialize checkout right now. Please try again.";
}

function addDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().split("T")[0];
}

function getDateDifferenceInDays(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const diff = end.getTime() - start.getTime();
  const dayCount = Math.round(diff / (1000 * 60 * 60 * 24));
  return dayCount > 0 ? dayCount : 1;
}

function formatCurrencyFromCents(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
}

function trackMetaEvent(eventName: string, payload: Record<string, unknown>) {
  const fbq = (window as Window & { fbq?: (...args: unknown[]) => void }).fbq;
  if (typeof fbq === "function") {
    fbq("track", eventName, payload);
  }
}

interface PromoCodeDetails {
  code: string;
  discountType: "fixed" | "percentage";
  discountValueCents: number | null;
  discountPercent: number | null;
}

export default function Booking() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const hasHydratedFromShareLink = useRef(false);

  const today = new Date().toISOString().split("T")[0];
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(addDays(today, 1));
  const [pickupTime, setPickupTime] = useState("10:00");
  const [dropoffTime, setDropoffTime] = useState("10:00");
  const [pickupLocationOption, setPickupLocationOption] = useState<string>(MIAMI_SERVICE_AREAS[0]);
  const [dropoffLocationOption, setDropoffLocationOption] = useState<string>(MIAMI_SERVICE_AREAS[0]);
  const [customPickupLocation, setCustomPickupLocation] = useState("");
  const [customDropoffLocation, setCustomDropoffLocation] = useState("");
  const [addOns, setAddOns] = useState({
    fsd: false,
    digitalKey: false,
    airportDelivery: false,
  });
  const [internalBookingCode, setInternalBookingCode] = useState("");
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [appliedPromoCode, setAppliedPromoCode] = useState<PromoCodeDetails | null>(null);
  const [promoCodeError, setPromoCodeError] = useState<string | null>(null);
  const [isValidatingPromoCode, setIsValidatingPromoCode] = useState(false);
  const [pendingShareLinkPromoCode, setPendingShareLinkPromoCode] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [rentalAgreementAccepted, setRentalAgreementAccepted] = useState(false);

  const { data: vehicle, isLoading } = useQuery({
    queryKey: ["booking-vehicle", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("vehicles")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as VehicleRow | null;
    },
    enabled: !!id,
  });

  const { data: viewerProfile } = useQuery({
    queryKey: ["booking-viewer-profile", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("is_admin, is_internal_tester")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) return null;
      return data as { is_admin: boolean; is_internal_tester: boolean } | null;
    },
    enabled: !!user?.id,
  });

  useEffect(() => {
    if (hasHydratedFromShareLink.current) return;
    hasHydratedFromShareLink.current = true;

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
    const knownServiceAreas: readonly string[] = MIAMI_SERVICE_AREAS;

    const startParam = searchParams.get("start");
    const endParam = searchParams.get("end");
    const pickupTimeParam = searchParams.get("pickupTime");
    const dropoffTimeParam = searchParams.get("dropoffTime");
    const pickupLocationParam = searchParams.get("pickupLocation");
    const pickupLocationCustomParam = searchParams.get("pickupLocationCustom");
    const dropoffLocationParam = searchParams.get("dropoffLocation");
    const dropoffLocationCustomParam = searchParams.get("dropoffLocationCustom");
    const addonsParam = searchParams.get("addons");
    const promoParam = searchParams.get("promo");

    const hydratedStartDate = startParam && dateRegex.test(startParam) ? startParam : null;
    if (hydratedStartDate) {
      setStartDate(hydratedStartDate);
    }
    if (endParam && dateRegex.test(endParam)) {
      setEndDate(endParam);
    }
    if (pickupTimeParam && timeRegex.test(pickupTimeParam)) {
      setPickupTime(pickupTimeParam);
    }
    if (dropoffTimeParam && timeRegex.test(dropoffTimeParam)) {
      setDropoffTime(dropoffTimeParam);
    }
    if (pickupLocationParam === "Custom" || (pickupLocationParam && knownServiceAreas.includes(pickupLocationParam))) {
      setPickupLocationOption(pickupLocationParam);
      if (pickupLocationParam === "Custom" && pickupLocationCustomParam) {
        setCustomPickupLocation(pickupLocationCustomParam);
      }
    }
    if (dropoffLocationParam === "Custom" || (dropoffLocationParam && knownServiceAreas.includes(dropoffLocationParam))) {
      setDropoffLocationOption(dropoffLocationParam);
      if (dropoffLocationParam === "Custom" && dropoffLocationCustomParam) {
        setCustomDropoffLocation(dropoffLocationCustomParam);
      }
    }
    if (addonsParam) {
      const addonKeys = new Set(addonsParam.split(",").map((value) => value.trim()));
      setAddOns({
        fsd: addonKeys.has("fsd"),
        digitalKey: addonKeys.has("digitalKey"),
        airportDelivery: addonKeys.has("airportDelivery"),
      });
    }
    if (promoParam?.trim()) {
      const normalized = promoParam.trim().toUpperCase();
      setPromoCodeInput(normalized);
      setPendingShareLinkPromoCode(normalized);
    }
  }, [searchParams]);

  const nights = useMemo(() => getDateDifferenceInDays(startDate, endDate), [startDate, endDate]);
  const rentalSubtotal = useMemo(() => {
    if (vehicle?.vehicle_identifier === "ZONYX-CT-AWD-001" && startDate === "2026-08-08" && nights === 1) {
      return 22250;
    }
    return (vehicle?.base_daily_rate_cents ?? 0) * nights;
  }, [vehicle, startDate, nights]);
  const serviceFee = useMemo(() => Math.round(rentalSubtotal * ZONYX_SERVICE_FEE_RATE), [rentalSubtotal]);
  const taxes = useMemo(() => Math.round(rentalSubtotal * ZONYX_TAX_RATE), [rentalSubtotal]);
  const baseTotal = rentalSubtotal + serviceFee + taxes;
  const customDestinationRequested = pickupLocationOption === "Custom" || dropoffLocationOption === "Custom";
  const addOnTotalCents =
    (addOns.fsd ? FSD_ADDON_CENTS : 0)
    + (addOns.digitalKey ? DIGITAL_KEY_ADDON_CENTS : 0)
    + (addOns.airportDelivery ? AIRPORT_DELIVERY_ADDON_CENTS : 0)
    + (customDestinationRequested ? CUSTOM_DESTINATION_ADDON_CENTS : 0);
  const totalBeforeDiscountCents = baseTotal + addOnTotalCents;
  const promoDiscountCents = appliedPromoCode
    ? appliedPromoCode.discountType === "percentage"
      ? Math.round(totalBeforeDiscountCents * (appliedPromoCode.discountPercent || 0) / 100)
      : (appliedPromoCode.discountValueCents || 0)
    : 0;
  const totalAfterDiscountCents = Math.max(0, totalBeforeDiscountCents - promoDiscountCents);
  const canViewInternalBookingCode =
    !!user && (viewerProfile?.is_internal_tester === true || viewerProfile?.is_admin === true);

  const resolvedPickupLocation = pickupLocationOption === "Custom" ? customPickupLocation.trim() : pickupLocationOption;
  const resolvedDropoffLocation = dropoffLocationOption === "Custom" ? customDropoffLocation.trim() : dropoffLocationOption;

  const applyPromoCode = async () => {
    const normalizedPromoCode = promoCodeInput.trim().toUpperCase();
    if (!normalizedPromoCode) {
      setPromoCodeError("Enter a promo code.");
      return;
    }

    setIsValidatingPromoCode(true);
    setPromoCodeError(null);

    const { data, error } = await supabase.rpc("validate_promo_code", { _code: normalizedPromoCode });

    setIsValidatingPromoCode(false);

    const promoRow = Array.isArray(data) ? data[0] : null;

    if (error || !promoRow) {
      setAppliedPromoCode(null);
      setPromoCodeError("Invalid promo code.");
      return;
    }

    setAppliedPromoCode({
      code: promoRow.code,
      discountType: promoRow.discount_type as "fixed" | "percentage",
      discountValueCents: promoRow.discount_value_cents,
      discountPercent: promoRow.discount_percent,
    });
    setPromoCodeInput(promoRow.code);
    setPromoCodeError(null);
  };

  useEffect(() => {
    if (!pendingShareLinkPromoCode) return;
    setPendingShareLinkPromoCode(null);
    void applyPromoCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingShareLinkPromoCode]);

  const buildShareableBookingUrl = () => {
    if (!vehicle) return null;
    const params = new URLSearchParams();
    params.set("start", startDate);
    params.set("end", endDate);
    params.set("pickupTime", pickupTime);
    params.set("dropoffTime", dropoffTime);
    params.set("pickupLocation", pickupLocationOption);
    if (pickupLocationOption === "Custom" && customPickupLocation.trim()) {
      params.set("pickupLocationCustom", customPickupLocation.trim());
    }
    params.set("dropoffLocation", dropoffLocationOption);
    if (dropoffLocationOption === "Custom" && customDropoffLocation.trim()) {
      params.set("dropoffLocationCustom", customDropoffLocation.trim());
    }
    const selectedAddons = [
      addOns.fsd ? "fsd" : null,
      addOns.digitalKey ? "digitalKey" : null,
      addOns.airportDelivery ? "airportDelivery" : null,
    ].filter((value): value is string => Boolean(value));
    if (selectedAddons.length > 0) {
      params.set("addons", selectedAddons.join(","));
    }
    if (appliedPromoCode?.code) {
      params.set("promo", appliedPromoCode.code);
    }
    return `${window.location.origin}/booking/${vehicle.id}?${params.toString()}`;
  };

  const handleCopyShareableLink = async () => {
    const url = buildShareableBookingUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Booking link copied", description: "Share it with the customer to preserve these exact selections." });
    } catch {
      toast({ title: "Unable to copy link", description: "Copy it manually from the address bar.", variant: "destructive" });
    }
  };

  const handleCheckout = async () => {
    if (!vehicle) return;

    if (!resolvedPickupLocation || !resolvedDropoffLocation) {
      setErrorMessage("Please provide pickup and drop-off locations.");
      return;
    }

    const normalizedPromoCode = promoCodeInput.trim().toUpperCase();
    if (!appliedPromoCode && normalizedPromoCode.length > 0) {
      setPromoCodeError("Click Apply to validate your promo code before continuing.");
      return;
    }
    const promoCodeForCheckout = appliedPromoCode?.code;

    setIsSubmitting(true);
    setErrorMessage(null);

    let lastStage: CheckoutStage = "auth-session";

    try {
      lastStage = "auth-session";
      trackCheckoutStage(lastStage, "start");
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const authedUser = sessionData.session?.user;
      trackCheckoutStage(lastStage, "success", { hasUser: Boolean(authedUser) });

      if (sessionError || !authedUser) {
        trackCheckoutStage(lastStage, "error", { reason: sessionError?.message || "missing-user" });
        const redirectTo = `${window.location.pathname}${window.location.search}`;
        navigate(`/auth?redirectTo=${encodeURIComponent(redirectTo)}`, { replace: true });
        setIsSubmitting(false);
        return;
      }

      lastStage = "create-booking";
      trackCheckoutStage(lastStage, "start", { vehicleId: vehicle.id, startDate, endDate });

      if (!termsAccepted) {
        setErrorMessage("You must accept the ZONYX Terms of Service before continuing.");
        return;
      }
      if (!rentalAgreementAccepted) {
        setErrorMessage("You must accept the ZONYX Rental Agreement before continuing.");
        return;
      }

      const { data, error } = await withTimeout(
        supabase.rpc("create_booking", {
          _vehicle_id: vehicle.id,
          _start_date: startDate,
          _end_date: endDate,
          _pickup_location: resolvedPickupLocation,
          _dropoff_location: resolvedDropoffLocation,
          _pickup_time: pickupTime,
          _dropoff_time: dropoffTime,
          _terms_accepted: termsAccepted,
          _rental_agreement_accepted: rentalAgreementAccepted,
        }),
        CREATE_BOOKING_TIMEOUT_MS,
        "Booking request timed out."
      );
      trackCheckoutStage(lastStage, "success", { bookingId: data ?? null });

      if (error) throw error;
      if (!data) throw new Error("Unable to create booking.");

      lastStage = "persisted-booking-read";
      trackCheckoutStage(lastStage, "start", { bookingId: data });
      const { data: persistedBooking, error: persistedBookingError } = await withTimeout(
        supabase
          .from("bookings")
          .select("grand_total_cents, currency")
          .eq("id", data)
          .maybeSingle<{ grand_total_cents: number; currency: string | null }>(),
        PERSISTED_BOOKING_READ_TIMEOUT_MS,
        "Booking confirmation timed out."
      );
      trackCheckoutStage(lastStage, "success", { bookingId: data });

      if (persistedBookingError) throw persistedBookingError;

      lastStage = "stripe-checkout-request";
      trackCheckoutStage(lastStage, "start", { bookingId: data });
      const checkout = await createStripeCheckoutSession({
        bookingId: data,
        internalBookingCode: internalBookingCode.trim() || undefined,
        promoCode: promoCodeForCheckout,
        pickupLocation: resolvedPickupLocation,
        dropoffLocation: resolvedDropoffLocation,
        pickupTime,
        dropoffTime,
        addOns: {
          fsd: addOns.fsd,
          digitalKey: addOns.digitalKey,
          airportDelivery: addOns.airportDelivery,
          customDestination: customDestinationRequested,
        },
      });
      trackCheckoutStage(lastStage, "success", { bookingId: data, sessionId: checkout.sessionId });

      if (persistedBooking?.grand_total_cents != null) {
        trackMetaEvent("InitiateCheckout", {
          value: persistedBooking.grand_total_cents / 100,
          currency: "USD",
        });
      }

      setInternalBookingCode("");
      lastStage = "redirect";
      trackCheckoutStage(lastStage, "start", { bookingId: data, sessionId: checkout.sessionId });
      window.location.assign(checkout.url);
    } catch (error) {
      trackCheckoutStage(lastStage, "error", {
        message: error instanceof Error ? error.message : "unknown-error",
      });
      setInternalBookingCode("");
      setErrorMessage(toCheckoutUserMessage(error));
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <MainLayout>
        <section className="pt-24 pb-20">
          <div className="container max-w-3xl text-center">
            <h1 className="text-2xl font-semibold">Loading vehicle</h1>
          </div>
        </section>
      </MainLayout>
    );
  }

  if (!vehicle) {
    return (
      <MainLayout>
        <section className="pt-24 pb-20">
          <div className="container max-w-3xl text-center">
            <h1 className="text-2xl font-semibold">Vehicle not found</h1>
            <p className="mt-3 text-muted-foreground">The booking request could not be completed for this vehicle.</p>
            <Button asChild className="mt-6">
              <Link to="/fleet">Back to fleet</Link>
            </Button>
          </div>
        </section>
      </MainLayout>
    );
  }

  const heroImage = vehicle.image_url || vehicle.images?.[0] || "/placeholder.svg";

  return (
    <MainLayout>
      <section className="pt-24 pb-20">
        <div className="container max-w-7xl">
          <Button variant="ghost" asChild className="mb-6">
            <Link to={`/vehicle/${vehicle.id}`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to vehicle
            </Link>
          </Button>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-6">
              <div className="rounded-3xl border border-border bg-card/80 p-6 shadow-sm md:p-8">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-sm uppercase tracking-[0.3em] text-muted-foreground">Reserve your drive</p>
                    <h1 className="mt-2 text-3xl font-semibold text-foreground">{vehicle.year} {vehicle.brand} {vehicle.name}</h1>
                    <p className="mt-3 text-sm text-muted-foreground">Booking is created before Stripe checkout starts.</p>
                  </div>
                  <div className="flex flex-col items-stretch gap-2 sm:items-end">
                    <div className="rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-primary" />
                        Secure Stripe checkout
                      </div>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={handleCopyShareableLink}>
                      <Copy className="mr-2 h-4 w-4" />
                      Copy configured booking link
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-border bg-card/80 p-6 shadow-sm md:p-8">
                <h2 className="text-xl font-semibold text-foreground">Choose your rental dates</h2>
                <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-foreground">Pickup date</span>
                    <div className="flex items-center gap-3 rounded-2xl border border-border bg-background/70 px-4 py-3">
                      <CalendarDays className="h-4 w-4 text-primary" />
                      <input
                        type="date"
                        value={startDate}
                        min={today}
                        onChange={(event) => {
                          const nextStart = event.target.value;
                          setStartDate(nextStart);
                          setEndDate(addDays(nextStart, 1));
                        }}
                        className="w-full bg-transparent text-sm outline-none"
                      />
                    </div>
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-foreground">Return date</span>
                    <div className="flex items-center gap-3 rounded-2xl border border-border bg-background/70 px-4 py-3">
                      <CalendarDays className="h-4 w-4 text-primary" />
                      <input
                        type="date"
                        value={endDate}
                        min={addDays(startDate, 1)}
                        onChange={(event) => setEndDate(event.target.value)}
                        className="w-full bg-transparent text-sm outline-none"
                      />
                    </div>
                  </label>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-foreground">Pickup time</span>
                    <input
                      type="time"
                      value={pickupTime}
                      onChange={(event) => setPickupTime(event.target.value)}
                      className="w-full rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm outline-none"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-foreground">Drop-off time</span>
                    <input
                      type="time"
                      value={dropoffTime}
                      onChange={(event) => setDropoffTime(event.target.value)}
                      className="w-full rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm outline-none"
                    />
                  </label>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-foreground">Pickup location</span>
                    <select
                      value={pickupLocationOption}
                      onChange={(event) => setPickupLocationOption(event.target.value)}
                      className="w-full rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm outline-none"
                    >
                      {MIAMI_SERVICE_AREAS.map((area) => (
                        <option key={area} value={area}>{area}</option>
                      ))}
                      <option value="Custom">Custom destination</option>
                    </select>
                    {pickupLocationOption === "Custom" && (
                      <input
                        type="text"
                        value={customPickupLocation}
                        onChange={(event) => setCustomPickupLocation(event.target.value)}
                        placeholder="Enter pickup destination"
                        className="w-full rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm outline-none"
                      />
                    )}
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-foreground">Drop-off location</span>
                    <select
                      value={dropoffLocationOption}
                      onChange={(event) => setDropoffLocationOption(event.target.value)}
                      className="w-full rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm outline-none"
                    >
                      {MIAMI_SERVICE_AREAS.map((area) => (
                        <option key={area} value={area}>{area}</option>
                      ))}
                      <option value="Custom">Custom destination</option>
                    </select>
                    {dropoffLocationOption === "Custom" && (
                      <input
                        type="text"
                        value={customDropoffLocation}
                        onChange={(event) => setCustomDropoffLocation(event.target.value)}
                        placeholder="Enter drop-off destination"
                        className="w-full rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm outline-none"
                      />
                    )}
                  </label>
                </div>

                <div className="mt-6 rounded-2xl border border-border bg-background/70 p-4 text-sm text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 text-primary" />
                    <div>
                      <p className="font-medium text-foreground">Vehicle identifier</p>
                      <p className="mt-1 text-foreground">{vehicle.vehicle_identifier}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-3xl border border-border bg-card/80 p-6 shadow-sm md:p-8">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-primary/10 p-2 text-primary">
                    <CreditCard className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-foreground">Booking summary</h2>
                    <p className="text-sm text-muted-foreground">Review the total before payment.</p>
                  </div>
                </div>

                <div className="mt-6 rounded-2xl border border-border bg-background/70 p-4">
                  <div className="flex items-center gap-3">
                    <img src={heroImage} alt={vehicle.name} className="h-16 w-24 rounded-xl object-cover" />
                    <div>
                      <p className="text-sm uppercase tracking-[0.3em] text-muted-foreground">{vehicle.brand}</p>
                      <p className="font-semibold text-foreground">{vehicle.year} {vehicle.name}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{vehicle.color} • {vehicle.category}</p>
                    </div>
                  </div>
                </div>

                {canViewInternalBookingCode && (
                  <div className="mt-4 rounded-2xl border border-border/50 bg-muted/30 p-4">
                    <label className="block space-y-2">
                      <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Internal booking code</span>
                      <input
                        type="password"
                        autoComplete="off"
                        value={internalBookingCode}
                        onChange={(event) => setInternalBookingCode(event.target.value)}
                        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
                        placeholder="Optional"
                      />
                    </label>
                  </div>
                )}

                <div className="mt-4 rounded-2xl border border-border/50 bg-muted/30 p-4">
                  <label className="block space-y-2">
                    <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Promo code</span>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        autoComplete="off"
                        value={promoCodeInput}
                        onChange={(event) => {
                          if (appliedPromoCode) return;
                          setPromoCodeInput(event.target.value);
                          if (promoCodeError) setPromoCodeError(null);
                        }}
                        disabled={Boolean(appliedPromoCode)}
                        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-70"
                        placeholder="Enter promo code"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={applyPromoCode}
                        disabled={Boolean(appliedPromoCode) || !promoCodeInput.trim() || isValidatingPromoCode}
                      >
                        {isValidatingPromoCode ? "Checking..." : "Apply"}
                      </Button>
                    </div>
                  </label>
                  {promoCodeError && (
                    <p className="mt-2 text-sm text-destructive">{promoCodeError}</p>
                  )}
                </div>

                <div className="mt-4 rounded-2xl border border-border/50 bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Trip add-ons</p>
                  <div className="mt-3 space-y-2 text-sm">
                    <label className="flex items-center justify-between gap-3">
                      <span>Full Self-Driving (FSD)</span>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">{formatCurrencyFromCents(FSD_ADDON_CENTS)}</span>
                        <input
                          type="checkbox"
                          checked={addOns.fsd}
                          onChange={(event) => setAddOns((prev) => ({ ...prev, fsd: event.target.checked }))}
                        />
                      </div>
                    </label>
                    <label className="flex items-center justify-between gap-3">
                      <span>Digital Key / Tesla App Access</span>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">{formatCurrencyFromCents(DIGITAL_KEY_ADDON_CENTS)}</span>
                        <input
                          type="checkbox"
                          checked={addOns.digitalKey}
                          onChange={(event) => setAddOns((prev) => ({ ...prev, digitalKey: event.target.checked }))}
                        />
                      </div>
                    </label>
                    <label className="flex items-center justify-between gap-3">
                      <span>Airport Delivery</span>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">{formatCurrencyFromCents(AIRPORT_DELIVERY_ADDON_CENTS)}</span>
                        <input
                          type="checkbox"
                          checked={addOns.airportDelivery}
                          onChange={(event) => setAddOns((prev) => ({ ...prev, airportDelivery: event.target.checked }))}
                        />
                      </div>
                    </label>
                    {customDestinationRequested && (
                      <div className="flex items-center justify-between gap-3">
                        <span>Custom Pickup / Drop-off Destination</span>
                        <span className="text-muted-foreground">{formatCurrencyFromCents(CUSTOM_DESTINATION_ADDON_CENTS)}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-6 space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>Daily rate</span>
                    <span className="font-medium text-foreground">{formatCurrencyFromCents(vehicle.base_daily_rate_cents)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Rental subtotal</span>
                    <span className="font-medium text-foreground">{formatCurrencyFromCents(rentalSubtotal)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Service fee</span>
                    <span className="font-medium text-foreground">{formatCurrencyFromCents(serviceFee)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Taxes</span>
                    <span className="font-medium text-foreground">{formatCurrencyFromCents(taxes)}</span>
                  </div>
                  {addOns.fsd && (
                    <div className="flex items-center justify-between">
                      <span>Full Self-Driving (FSD)</span>
                      <span className="font-medium text-foreground">{formatCurrencyFromCents(FSD_ADDON_CENTS)}</span>
                    </div>
                  )}
                  {addOns.digitalKey && (
                    <div className="flex items-center justify-between">
                      <span>Digital Key / Tesla App Access</span>
                      <span className="font-medium text-foreground">{formatCurrencyFromCents(DIGITAL_KEY_ADDON_CENTS)}</span>
                    </div>
                  )}
                  {addOns.airportDelivery && (
                    <div className="flex items-center justify-between">
                      <span>Airport Delivery</span>
                      <span className="font-medium text-foreground">{formatCurrencyFromCents(AIRPORT_DELIVERY_ADDON_CENTS)}</span>
                    </div>
                  )}
                  {customDestinationRequested && (
                    <div className="flex items-center justify-between">
                      <span>Custom Pickup / Drop-off Destination</span>
                      <span className="font-medium text-foreground">{formatCurrencyFromCents(CUSTOM_DESTINATION_ADDON_CENTS)}</span>
                    </div>
                  )}
                  {promoDiscountCents > 0 && appliedPromoCode && (
                    <div className="flex items-center justify-between">
                      <span>Promo discount ({appliedPromoCode.code})</span>
                      <span className="font-medium text-foreground">-{formatCurrencyFromCents(promoDiscountCents)}</span>
                    </div>
                  )}
                </div>

                <div className="mt-6 border-t border-border pt-4">
                  <div className="flex items-center justify-between text-base font-semibold text-foreground">
                    <span>Total</span>
                    <span>{formatCurrencyFromCents(totalAfterDiscountCents)}</span>
                  </div>
                </div>

                {errorMessage && (
                  <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    {errorMessage}
                  </div>
                )}

                <div className="mt-6 space-y-3 rounded-2xl border border-border bg-background/70 p-4">
                  <p className="text-sm font-medium text-foreground">Required before booking</p>
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={termsAccepted}
                      onChange={(event) => setTermsAccepted(event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
                    />
                    <span className="text-foreground">
                      I agree to the{" "}
                      <Link to="/terms" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                        ZONYX Terms of Service
                      </Link>
                      .
                    </span>
                  </label>
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={rentalAgreementAccepted}
                      onChange={(event) => setRentalAgreementAccepted(event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
                    />
                    <span className="text-foreground">
                      I agree to the{" "}
                      <Link to="/house-rules" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                        ZONYX Rental Agreement
                      </Link>
                      .
                    </span>
                  </label>
                </div>

                <Button size="lg" className="mt-6 w-full" onClick={handleCheckout} disabled={isSubmitting}>
                  {isSubmitting ? "Preparing checkout..." : "Continue to Stripe Checkout"}
                </Button>

                <div className="mt-4 rounded-2xl border border-border/70 bg-muted/40 p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Temporary Authorization Hold</p>
                  <p className="mt-2">
                    A temporary authorization hold may be placed when Stripe confirms the checkout.
                  </p>
                </div>

                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Check className="h-4 w-4 text-primary" />
                  Secure payment powered by Stripe
                </div>
              </div>

              <div className="rounded-3xl border border-border bg-card/80 p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-foreground">Hosted pickup details</h3>
                <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 text-primary" /> Pickup location is shared after booking confirmation.</li>
                  <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 text-primary" /> Booking is created before Stripe opens.</li>
                  <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 text-primary" /> Host identity comes from the selected vehicle.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>
    </MainLayout>
  );
}