import { attachPartnerToBooking, getPartnerReferral, rememberPartner } from "@/lib/partners";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RentalAgreementDocument } from "@/components/legal/RentalAgreementDocument";
import { TrustedReservationAgreementDialog } from "@/components/admin/TrustedReservationAgreementDialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { ZONYX_SERVICE_FEE_RATE, ZONYX_TAX_RATE } from "@/lib/rentalPricing";
import { …9023 tokens truncated…          <MapPin className="mt-0.5 h-4 w-4 text-primary" />
                    <div>
                      <p className="font-medium text-foreground">Vehicle identifier</p>
                      <p className="mt-1 text-foreground">{vehicle.vehicle_identifier}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="zonyx-booking-summary rounded-3xl border border-border bg-card/80 p-6 shadow-sm md:p-8">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-primary/10 p-2 text-primary">
                    <CreditCard className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="zonyx-booking-heading text-xl font-semibold text-foreground">Booking summary</h2>
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
                        <span className="text-muted-foreground">{complimentaryDelivery ? "Complimentary" : formatCurrencyFromCents(AIRPORT_DELIVERY_ADDON_CENTS)}</span>
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
                        <span className="text-muted-foreground">{complimentaryDelivery ? "Complimentary" : formatCurrencyFromCents(CUSTOM_DESTINATION_ADDON_CENTS)}</span>
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
                    <span className="font-medium text-foreground">{formatCurrencyFromCents(verifiedSummary?.subtotal_cents ?? rentalSubtotal)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Service fee</span>
                    <span className="font-medium text-foreground">{formatCurrencyFromCents(verifiedSummary?.service_fee_cents ?? serviceFee)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Taxes</span>
                    <span className="font-medium text-foreground">{formatCurrencyFromCents(verifiedSummary?.taxes_cents ?? taxes)}</span>
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
                      <span className="font-medium text-foreground">{complimentaryDelivery ? "Complimentary" : formatCurrencyFromCents(AIRPORT_DELIVERY_ADDON_CENTS)}</span>
                    </div>
                  )}
                  {customDestinationRequested && (
                    <div className="flex items-center justify-between">
                      <span>Custom Pickup / Drop-off Destination</span>
                      <span className="font-medium text-foreground">{complimentaryDelivery ? "Complimentary" : formatCurrencyFromCents(CUSTOM_DESTINATION_ADDON_CENTS)}</span>
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
                    <span>{formatCurrencyFromCents(verifiedSummary?.final_total_cents ?? totalAfterDiscountCents)}</span>
                  </div>
                </div>

                <details className="mb-5 rounded border border-border p-4"><summary className="cursor-pointer text-sm">Partner referral code (optional)</summary><label className="mt-3 block text-sm">Referral code<input value={partnerCode} maxLength={24} onChange={e=>setPartnerCode(e.target.value)} className="mt-2 w-full rounded border border-input bg-background p-3"/></label><button type="button" className="mt-3 text-sm text-primary" onClick={async()=>{try{await rememberPartner(partnerCode,"code");setPartnerMessage("Partner referral saved for this booking.");}catch(e){setPartnerMessage(e instanceof Error?e.message:"Unable to apply code.");}}}>Apply partner code</button>{partnerMessage&&<p role="status" className="mt-2 text-sm">{partnerMessage}</p>}</details>
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
                  <div className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={rentalAgreementAccepted}
                      readOnly
                      onClick={() => void handleReviewRentalAgreement()}
                      aria-label="Review the booking-specific ZONYX Rental Agreement"
                      className="mt-0.5 h-4 w-4 cursor-pointer rounded border-border accent-primary"
                    />
                    <span className="text-foreground">
                      I agree to the{" "}
                      <button
                        type="button"
                        onClick={handleReviewRentalAgreement}
                        disabled={agreementLoading}
                        className="text-primary underline underline-offset-2 disabled:opacity-60"
                      >
                        ZONYX Rental Agreement
                      </button>
                      .
                    </span>
                  </div>
                </div>

                <Button
  size="lg"
  className="zonyx-booking-primary mt-6 w-full rounded-none uppercase tracking-[0.14em] shadow-none"
  onClick={handleCheckout}
  disabled={minimumDurationInvalid || isSubmitting || !isAvailable || availabilityLoading || availabilityError || rentalDaysLoading || rentalDaysError}
>
  {minimumDurationInvalid ? `Minimum rental: ${minimumHours} hours` : isSubmitting ? "Preparing checkout..." : availabilityLoading || rentalDaysLoading ? "Checking availability..." : availabilityError || rentalDaysError ? "Unable to check availability" : !isAvailable ? "Vehicle unavailable for these dates" : internalPayPalCheckoutEnabled(canViewInternalBookingCode) ? (import.meta.env.VITE_PAYPAL_CUSTOMER_CHECKOUT_ENABLED === "true" ? "Continue to secure payment" : "Continue to secure payment (internal test)") : "Continue to secure payment"}
</Button>

{!isAvailable && !availabilityLoading && (
  <div className="mt-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
    <p className="font-medium">Vehicle not available</p>
    <p className="mt-1">
      This vehicle is not available for the selected dates and times. Please adjust your pickup/drop-off times or choose another vehicle in the fleet.
    </p>
  </div>
)}

{availabilityError && (
  <div className="mt-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
    Unable to check availability right now. Please try again before continuing.
  </div>
)}

                <div className="mt-4 rounded-2xl border border-border/70 bg-muted/40 p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Temporary Authorization Hold</p>
                  <p className="mt-2">
                    We may place a temporary authorization hold on your card. This is not a charge. The hold is typically released within 7 days, depending on your bank.
                  </p>
                </div>

                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Check className="h-4 w-4 text-primary" />
                  ZONYX secure payment
                </div>
              </div>

              <div className="zonyx-booking-section rounded-3xl border border-border bg-card/80 p-6 shadow-sm">
                <h3 className="zonyx-booking-heading text-lg font-semibold text-foreground">Pickup details</h3>
                <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 text-primary" /> Pickup location is shared after booking confirmation.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>
      <Dialog open={agreementOpen} onOpenChange={setAgreementOpen}>
        <DialogContent className="zonyx-booking-agreement max-h-[92vh] max-w-4xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-none p-0">
          <DialogHeader className="border-b border-border px-6 py-5">
            <DialogTitle>Booking-Specific ZONYX Rental Agreement</DialogTitle>
            <DialogDescription>
              Review the exact agreement and financial terms for this reservation before accepting.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="min-h-0 px-6 pb-6">
            {preparedAgreement && (
              <article className="space-y-6 py-6 text-sm leading-relaxed text-foreground/90 md:text-base">
                <RentalAgreementDocument text={preparedAgreement.renderedText} />
                <section className="border-t border-border pt-5 text-xs text-muted-foreground">
                  <p>Proposed Booking ID: {preparedAgreement.proposedBookingId}</p>
                  <p>Master Agreement Version: {preparedAgreement.masterVersion}</p>
                  <p className="break-all">Document Hash: {preparedAgreement.documentHash}</p>
                </section>
              </article>
            )}
          </ScrollArea>
          <DialogFooter className="border-t border-border px-6 py-4">
            <Button
              type="button"
              onClick={handleAcceptReviewedRentalAgreement}
              disabled={!preparedAgreement || preparedAgreementFingerprint !== agreementFingerprint}
              className="zonyx-booking-primary rounded-none uppercase tracking-[0.12em] shadow-none"
            >
              Accept This Rental Agreement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <TrustedReservationAgreementDialog
        open={trustedDialogOpen}
        onOpenChange={setTrustedDialogOpen}
        vehicleId={vehicle.id}
        startDate={startDate}
        endDate={endDate}
        pickupTime={pickupTime}
        dropoffTime={dropoffTime}
        pickupLocation={resolvedPickupLocation}
        dropoffLocation={resolvedDropoffLocation}
        buildUrl={(contextId) => buildShareableBookingUrl(contextId) || ""}
      />
    </MainLayout>
  );
}
