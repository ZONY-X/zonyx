import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar, Copy, CreditCard, DollarSign, Link2, MapPin, MoreVertical } from "lucide-react";
import { format } from "date-fns";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { isPastReservation } from "@/lib/reservationTime";
import { createStripeCheckoutSession } from "@/lib/stripe";

const KNOWN_SERVICE_AREAS = [
  "Coconut Grove",
  "Brickell",
  "Downtown Miami",
  "Wynwood",
  "Miami Beach",
  "Coral Gables",
  "Edgewater",
  "Miami International Airport",
];

const normalizeTimeForInput = (time?: string | null) => {
  if (!time) return "";
  // Database time values are HH:mm:ss; the booking page expects HH:mm.
  return time.length >= 5 ? time.slice(0, 5) : time;
};

const formatCurrencyFromCents = (cents?: number | string | null) => {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);
};

interface HostBookingsTabProps {
  hostId: string;
  isAdmin: boolean;
}

type BookingListItem = {
  id: string;
  vehicle_id: string;
  start_date: string;
  end_date: string;
  pickup_location?: string | null;
  dropoff_location?: string | null;
  pickup_time?: string | null;
  dropoff_time?: string | null;
  reservation_number?: string | null;
  trip_status: string;
  subtotal_cents?: number | string | null;
  service_fee_cents?: number | string | null;
  taxes_cents?: number | string | null;
  grand_total_cents?: number | string | null;
  stripe_checkout_session_id?: string | null;
  vehicles?: {
    model?: string | null;
    brand?: string | null;
    image_url?: string | null;
  } | null;
};

export function HostBookingsTab({
  hostId,
  isAdmin,
}: HostBookingsTabProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedBooking, setSelectedBooking] = useState<BookingListItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkMode, setBulkMode] = useState(false);
  const [confirmation, setConfirmation] = useState<{ action: "cancel" | "delete"; ids: string[] } | null>(null);
  const [managingBooking, setManagingBooking] = useState<BookingListItem | null>(null);
  const [pickupTimeDraft, setPickupTimeDraft] = useState("");
  const [dropoffTimeDraft, setDropoffTimeDraft] = useState("");
  const [subtotalDraft, setSubtotalDraft] = useState("0.00");
  const [serviceFeeDraft, setServiceFeeDraft] = useState("0.00");
  const [taxesDraft, setTaxesDraft] = useState("0.00");

  const {
    data: bookings,
    isLoading
  } = useQuery({
    queryKey: ["host-bookings", hostId],
    queryFn: async () => {
      const {
        data,
        error
      } = await supabase.from("bookings").select(`
          id,
          vehicle_id,
          start_date,
          end_date,
          pickup_location,
          dropoff_location,
          pickup_time,
          dropoff_time,
          reservation_number,
          trip_status,
          subtotal_cents,
          service_fee_cents,
          taxes_cents,
          grand_total_cents,
          stripe_checkout_session_id,
          vehicles (model, brand, image_url)
        `).eq("host_profile_id", hostId).order("start_date", {
        ascending: true
      });
      if (error) throw error;
      return (data ?? []).filter((booking) => {
        const activeStatuses = ["pending_payment", "confirmed", "active", "pending_inspection"];
        return activeStatuses.includes(booking.trip_status) && !isPastReservation(booking.end_date, booking.dropoff_time);
      });
    }
  });

  const refreshBookings = () => {
    setSelectedIds([]);
    queryClient.invalidateQueries({ queryKey: ["host-bookings", hostId] });
    queryClient.invalidateQueries({ queryKey: ["host-history", hostId] });
  };

  const cancelMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        const { error } = await supabase.rpc("cancel_booking", { _booking_id: id });
        if (error) throw error;
      }
    },
    onSuccess: (_, ids) => {
      refreshBookings();
      toast({ title: ids.length === 1 ? "Booking cancelled." : `${ids.length} bookings cancelled.` });
    },
    onError: (error) => toast({ title: "Unable to cancel booking", description: error.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        const { error } = await supabase.rpc("delete_booking", { _booking_id: id });
        if (error) throw error;
      }
    },
    onSuccess: (_, ids) => {
      refreshBookings();
      toast({ title: ids.length === 1 ? "Booking permanently deleted." : `${ids.length} bookings permanently deleted.` });
    },
    onError: (error) => toast({ title: "Unable to delete booking", description: error.message, variant: "destructive" }),
  });

  const openManageDialog = (booking: BookingListItem) => {
    setManagingBooking(booking);
    setPickupTimeDraft(normalizeTimeForInput(booking.pickup_time));
    setDropoffTimeDraft(normalizeTimeForInput(booking.dropoff_time));
    setSubtotalDraft((Number(booking.subtotal_cents || 0) / 100).toFixed(2));
    setServiceFeeDraft((Number(booking.service_fee_cents || 0) / 100).toFixed(2));
    setTaxesDraft((Number(booking.taxes_cents || 0) / 100).toFixed(2));
  };

  const buildBookingLink = (booking: BookingListItem) => {
    const params = new URLSearchParams();
    params.set("start", booking.start_date);
    params.set("end", booking.end_date);
    if (booking.pickup_time) params.set("pickupTime", normalizeTimeForInput(booking.pickup_time));
    if (booking.dropoff_time) params.set("dropoffTime", normalizeTimeForInput(booking.dropoff_time));
    if (booking.pickup_location) {
      params.set("pickupLocation", KNOWN_SERVICE_AREAS.includes(booking.pickup_location) ? booking.pickup_location : "Custom");
      if (!KNOWN_SERVICE_AREAS.includes(booking.pickup_location)) {
        params.set("pickupLocationCustom", booking.pickup_location);
      }
    }
    if (booking.dropoff_location) {
      params.set("dropoffLocation", KNOWN_SERVICE_AREAS.includes(booking.dropoff_location) ? booking.dropoff_location : "Custom");
      if (!KNOWN_SERVICE_AREAS.includes(booking.dropoff_location)) {
        params.set("dropoffLocationCustom", booking.dropoff_location);
      }
    }
    return `${window.location.origin}/booking/${booking.vehicle_id}?${params.toString()}`;
  };

  const copyBookingLink = async (booking: BookingListItem) => {
    const url = buildBookingLink(booking);
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Booking link copied", description: "Share it with the customer to open this configured booking." });
    } catch {
      toast({ title: "Unable to copy booking link", description: "Copy it manually from the address bar.", variant: "destructive" });
    }
  };

  const paymentLinkMutation = useMutation({
    mutationFn: async (bookingId: string) => {
      const checkout = await createStripeCheckoutSession({ bookingId });
      return checkout.url;
    },
    onSuccess: async (url) => {
      try {
        await navigator.clipboard.writeText(url);
        toast({ title: "Payment link copied", description: "Send it to the customer to complete payment for this booking." });
      } catch {
        toast({ title: "Payment link ready", description: "Copy it manually from the address bar.", variant: "destructive" });
      }
    },
    onError: (error) => toast({ title: "Unable to create payment link", description: error.message, variant: "destructive" }),
  });

  const updateOperationalDetailsMutation = useMutation({
    mutationFn: async (booking: BookingListItem) => {
      const payload: {
        _booking_id: string;
        _pickup_time?: string | null;
        _dropoff_time?: string | null;
        _subtotal_cents?: number;
        _service_fee_cents?: number;
        _taxes_cents?: number;
      } = {
        _booking_id: booking.id,
        _pickup_time: pickupTimeDraft || null,
        _dropoff_time: dropoffTimeDraft || null,
      };
      const canEditPrice = booking.trip_status === "pending_payment" && !booking.stripe_checkout_session_id;
      if (canEditPrice) {
        payload._subtotal_cents = Math.round(Number(subtotalDraft || 0) * 100);
        payload._service_fee_cents = Math.round(Number(serviceFeeDraft || 0) * 100);
        payload._taxes_cents = Math.round(Number(taxesDraft || 0) * 100);
      }
      const { error } = await supabase.rpc("update_booking_operational_details", payload);
      if (error) throw error;
    },
    onSuccess: () => {
      refreshBookings();
      setManagingBooking(null);
      toast({ title: "Booking updated" });
    },
    onError: (error) => toast({ title: "Unable to update booking", description: error.message, variant: "destructive" }),
  });

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id]);
  };

  const toggleAll = () => {
    if (!bookings) return;
    setSelectedIds(selectedIds.length === bookings.length ? [] : bookings.map((booking) => booking.id));
  };

  const isMutating = cancelMutation.isPending || deleteMutation.isPending;

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending_payment":
        return "bg-amber-500/10 text-amber-500 border-amber-500/20";
      case "confirmed":
        return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      case "active":
        return "bg-green-500/10 text-green-500 border-green-500/20";
      case "pending_inspection":
        return "bg-violet-500/10 text-violet-500 border-violet-500/20";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const formatStatus = (status: string) => status.replace(/_/g, " ");

  if (isLoading) {
    return <Card>
        <CardContent className="py-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mx-auto"></div>
        </CardContent>
      </Card>;
  }
  return <div className="space-y-6">
      <div className="flex flex-col gap-3 text-center sm:flex-row sm:items-end sm:justify-between sm:text-left">
        <div>
          <h2 className="text-2xl font-bold uppercase text-primary">BOOKED TRIPS</h2>
          <p className="text-muted-foreground">View and Manage Your Active Reservations</p>
        </div>
        {isAdmin && <div className="flex justify-center gap-2 sm:justify-end">
          {bulkMode && <Button type="button" variant="outline" size="sm" onClick={toggleAll} disabled={!bookings?.length || isMutating}>
            {selectedIds.length === bookings?.length ? "Clear all" : "Select all"}
          </Button>}
          <Button type="button" variant={bulkMode ? "default" : "outline"} size="sm" onClick={() => { setBulkMode((value) => !value); setSelectedIds([]); }}>
            {bulkMode ? "Done" : "Bulk select"}
          </Button>
        </div>}
      </div>

      {isAdmin && bulkMode && selectedIds.length > 0 && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
        <span className="mr-auto text-sm text-muted-foreground">{selectedIds.length} selected</span>
        <Button type="button" size="sm" variant="outline" onClick={() => setConfirmation({ action: "cancel", ids: selectedIds })} disabled={isMutating}>Cancel selected</Button>
        <Button type="button" size="sm" variant="destructive" onClick={() => setConfirmation({ action: "delete", ids: selectedIds })} disabled={isMutating}>Delete permanently</Button>
      </div>}

      {bookings && bookings.length > 0 ? <div className="grid gap-4">
          {bookings.map(booking => <Card key={booking.id}>
              <CardContent className="p-4">
                <div className="flex flex-col md:flex-row md:items-center gap-4">
                  {isAdmin && bulkMode && <Checkbox checked={selectedIds.includes(booking.id)} onCheckedChange={() => toggleSelected(booking.id)} aria-label={`Select booking ${booking.reservation_number || booking.id}`} />}
                  <div className="w-full md:w-32 h-20 bg-muted rounded-lg overflow-hidden">
                    <img src={booking.vehicles?.image_url || "/placeholder.svg"} alt={booking.vehicles?.model || "Vehicle"} className="w-full h-full object-cover" />
                  </div>
                  
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-semibold">
                        {booking.vehicles?.brand} {booking.vehicles?.model}
                      </h3>
                      <Badge className={getStatusColor(booking.trip_status)}>
                        {formatStatus(booking.trip_status)}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        {format(new Date(booking.start_date), "MMM d")} - {format(new Date(booking.end_date), "MMM d, yyyy")}
                      </div>
                      <div className="flex items-center gap-1">
                        <MapPin className="w-4 h-4" />
                        {booking.pickup_location || "TBD"}
                      </div>
                      <div className="flex items-center gap-1">
                        <DollarSign className="w-4 h-4" />
                        ${(Number(booking.grand_total_cents || 0) / 100).toFixed(2)}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {booking.trip_status === "pending_payment" && <Button size="sm" variant="outline" disabled>Awaiting Payment</Button>}
                    {booking.trip_status === "confirmed" && <Button size="sm" disabled>Scheduled</Button>}
                    {booking.trip_status === "active" && <Button size="sm" disabled>In Progress</Button>}
                    {booking.trip_status === "pending_inspection" && <Button size="sm" disabled>Inspection Pending</Button>}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" size="icon" aria-label="Booking actions" disabled={isMutating}>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setSelectedBooking(booking)}>View details</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => openManageDialog(booking)} disabled={updateOperationalDetailsMutation.isPending}>Edit booking</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => copyBookingLink(booking)}>
                          <Copy className="mr-2 h-4 w-4" /> Copy booking link
                        </DropdownMenuItem>
                        {booking.trip_status === "pending_payment" && (
                          <DropdownMenuItem onSelect={() => paymentLinkMutation.mutate(booking.id)} disabled={paymentLinkMutation.isPending}>
                            <CreditCard className="mr-2 h-4 w-4" /> Copy payment link
                          </DropdownMenuItem>
                        )}
                        {booking.trip_status !== "cancelled" && booking.trip_status !== "completed" && <DropdownMenuItem onSelect={() => setConfirmation({ action: "cancel", ids: [booking.id] })}>Cancel booking</DropdownMenuItem>}
                        {isAdmin && <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onSelect={() => setConfirmation({ action: "delete", ids: [booking.id] })}>Delete permanently</DropdownMenuItem>
                        </>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardContent>
            </Card>)}
        </div> : <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="w-12 h-12 text-primary mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Active BOOKINGS </h3>
            <p className="text-primary font-sans text-xs">
              When Renters Book your Vehicle They'll Appear Here
            </p>
          </CardContent>
        </Card>}
      <Dialog open={!!selectedBooking} onOpenChange={() => setSelectedBooking(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Booking details</DialogTitle></DialogHeader>
          {selectedBooking && <div className="space-y-3 text-sm">
            <p className="text-lg font-semibold">{selectedBooking.vehicles?.brand} {selectedBooking.vehicles?.model}</p>
            <p><span className="text-muted-foreground">Reservation:</span> {selectedBooking.reservation_number || selectedBooking.id}</p>
            <p><span className="text-muted-foreground">Dates:</span> {format(new Date(selectedBooking.start_date), "MMM d, yyyy")} - {format(new Date(selectedBooking.end_date), "MMM d, yyyy")}</p>
            <p><span className="text-muted-foreground">Pickup:</span> {selectedBooking.pickup_location || "TBD"} {selectedBooking.pickup_time ? `at ${normalizeTimeForInput(selectedBooking.pickup_time)}` : ""}</p>
            <p><span className="text-muted-foreground">Drop-off:</span> {selectedBooking.dropoff_location || "TBD"} {selectedBooking.dropoff_time ? `at ${normalizeTimeForInput(selectedBooking.dropoff_time)}` : ""}</p>
            <p><span className="text-muted-foreground">Status:</span> {formatStatus(selectedBooking.trip_status)}</p>
            <p><span className="text-muted-foreground">Total:</span> {formatCurrencyFromCents(selectedBooking.grand_total_cents)}</p>
            <div className="flex flex-wrap gap-2 pt-2 border-t">
              <Button type="button" size="sm" variant="outline" onClick={() => copyBookingLink(selectedBooking)}>
                <Copy className="mr-2 h-4 w-4" /> Copy booking link
              </Button>
              {selectedBooking.trip_status === "pending_payment" && (
                <Button type="button" size="sm" variant="outline" onClick={() => paymentLinkMutation.mutate(selectedBooking.id)} disabled={paymentLinkMutation.isPending}>
                  <CreditCard className="mr-2 h-4 w-4" /> Copy payment link
                </Button>
              )}
              <Button type="button" size="sm" onClick={() => { setSelectedBooking(null); openManageDialog(selectedBooking); }}>
                Edit booking
              </Button>
            </div>
          </div>}
        </DialogContent>
      </Dialog>

<Dialog open={!!managingBooking} onOpenChange={(open) => { if (!open) setManagingBooking(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit booking</DialogTitle></DialogHeader>
          {managingBooking && <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); updateOperationalDetailsMutation.mutate(managingBooking); }}>
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p className="font-semibold">{managingBooking.vehicles?.brand} {managingBooking.vehicles?.model}</p>
              <p className="text-muted-foreground mt-1">Reservation: {managingBooking.reservation_number || managingBooking.id}</p>
              <p className="text-muted-foreground">{format(new Date(managingBooking.start_date), "MMM d, yyyy")} - {format(new Date(managingBooking.end_date), "MMM d, yyyy")} · {formatStatus(managingBooking.trip_status)}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="pickup-time-field">Pickup time</Label>
                <Input id="pickup-time-field" type="time" value={pickupTimeDraft} onChange={(e) => setPickupTimeDraft(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dropoff-time-field">Drop-off time</Label>
                <Input id="dropoff-time-field" type="time" value={dropoffTimeDraft} onChange={(e) => setDropoffTimeDraft(e.target.value)} />
              </div>
            </div>

            <div className="rounded-lg border border-border p-3">
              <p className="text-sm font-medium mb-1">Booking price correction</p>
              <p className="text-xs text-muted-foreground mb-3">
                Corrects the price on this individual booking only. The vehicle daily rate in the Vehicles tab is untouched. This is locked once payment is captured or a checkout session already exists.
              </p>
              {managingBooking.trip_status === "pending_payment" && !managingBooking.stripe_checkout_session_id ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="subtotal-field">Subtotal</Label>
                    <Input id="subtotal-field" type="number" min="0" step="0.01" value={subtotalDraft} onChange={(e) => setSubtotalDraft(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="service-fee-field">Service fee</Label>
                    <Input id="service-fee-field" type="number" min="0" step="0.01" value={serviceFeeDraft} onChange={(e) => setServiceFeeDraft(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="taxes-field">Taxes</Label>
                    <Input id="taxes-field" type="number" min="0" step="0.01" value={taxesDraft} onChange={(e) => setTaxesDraft(e.target.value)} />
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Price editing is locked for this booking (status: {formatStatus(managingBooking.trip_status)}{managingBooking.stripe_checkout_session_id ? ", checkout session already opened" : ""}).</p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => copyBookingLink(managingBooking)}>
                <Copy className="mr-2 h-4 w-4" /> Copy booking link
              </Button>
              {managingBooking.trip_status === "pending_payment" && (
                <Button type="button" size="sm" variant="outline" onClick={() => paymentLinkMutation.mutate(managingBooking.id)} disabled={paymentLinkMutation.isPending}>
                  <Link2 className="mr-2 h-4 w-4" /> Copy payment link
                </Button>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" onClick={() => setManagingBooking(null)}>Cancel</Button>
              <Button type="submit" disabled={updateOperationalDetailsMutation.isPending}>
                {updateOperationalDetailsMutation.isPending ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </form>}
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!confirmation} onOpenChange={(open) => !open && setConfirmation(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.action === "delete" ? "Delete booking permanently?" : "Cancel booking?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation?.action === "delete"
                ? "This permanently removes the booking record for test or invalid data. It does not refund or modify Stripe transactions."
                : "This preserves the booking record and payment history while immediately releasing its vehicle dates."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep booking</AlertDialogCancel>
            <AlertDialogAction
              className={confirmation?.action === "delete" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
              onClick={() => {
                if (!confirmation) return;
                const action = confirmation.action === "delete" ? deleteMutation : cancelMutation;
                action.mutate(confirmation.ids);
                setConfirmation(null);
              }}
            >
              {confirmation?.action === "delete" ? "Delete permanently" : "Cancel booking"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>;
}