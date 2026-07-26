import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, History, ChevronRight, Star } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import { useState } from "react";
import { TripRatingDialog } from "./TripRatingDialog";

// Parse date string as local date (avoid timezone shift)
const parseLocalDate = (dateStr: string) => {
  // parseISO handles "YYYY-MM-DD" correctly as local date
  return parseISO(dateStr);
};
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface GuestHistoryTabProps {
  guestId: string;
}

export function GuestHistoryTab({ guestId }: GuestHistoryTabProps) {
  const { user } = useAuth();

  const { data: bookings, isLoading } = useQuery({
    queryKey: ["guest-history", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      // First fetch bookings with vehicle info
      const { data: bookingsData, error: bookingsError } = await supabase
        .from("bookings")
        .select(`
          *,
          vehicles (name, brand, image_url)
        `)
        .eq("renter_id", user.id)
        .in("status", ["completed", "cancelled"])
        .order("end_date", { ascending: false });

      if (bookingsError) {
        console.error("Error fetching history:", bookingsError);
        return [];
      }

      if (!bookingsData || bookingsData.length === 0) return [];

      // Get unique host IDs
      const hostIds = [...new Set(bookingsData.map(b => b.host_id))];
      
      // Fetch host info from hosts_public view
      const { data: hostsData } = await supabase
        .from("hosts_public")
        .select("id, host_name, avatar_url")
        .in("id", hostIds);

      // Fetch ratings for these bookings
      const bookingIds = bookingsData.map(b => b.id);
      const { data: ratingsData } = await supabase
        .from("ratings")
        .select("*")
        .in("booking_id", bookingIds)
        .eq("rater_id", user.id);

      // Map hosts and ratings to bookings
      const hostsMap = new Map(hostsData?.map(h => [h.id, h]) || []);
      const ratingsMap = new Map(ratingsData?.map(r => [r.booking_id, r]) || []);
      
      return bookingsData.map(booking => ({
        ...booking,
        host_info: hostsMap.get(booking.host_id) || null,
        user_rating: ratingsMap.get(booking.id) || null
      }));
    },
    enabled: !!user?.id,
  });

  const totalSpent = bookings?.reduce((sum, b) => 
    b.status === "completed" ? sum + Number(b.total_price) : sum, 0
  ) || 0;

  const completedTrips = bookings?.filter(b => b.status === "completed").length || 0;

  const [selectedBooking, setSelectedBooking] = useState<any>(null);
  const [ratingDialogOpen, setRatingDialogOpen] = useState(false);
  const [bookingToRate, setBookingToRate] = useState<any>(null);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Spent</p>
            <p className="text-2xl font-bold text-primary">${totalSpent.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Completed Trips</p>
            <p className="text-2xl font-bold">{completedTrips}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Trips</p>
            <p className="text-2xl font-bold">{bookings?.length || 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* History List */}
      {(!bookings || bookings.length === 0) ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <History className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No trip history yet</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Trip History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {bookings.map((booking) => (
                <div 
                  key={booking.id} 
                  className="flex items-center gap-4 p-4 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => setSelectedBooking(booking)}
                >
                  <div className="w-20 h-16 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                    <img
                      src={booking.vehicles?.image_url || "/placeholder.svg"}
                      alt={booking.vehicles?.name || "Vehicle"}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {booking.vehicles?.brand} {booking.vehicles?.name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {format(parseLocalDate(booking.start_date), "MMM d, yyyy")}{booking.pickup_time ? ` ${booking.pickup_time.slice(0,5)}` : ""} — {format(parseLocalDate(booking.end_date), "MMM d, yyyy")}{booking.dropoff_time ? ` ${booking.dropoff_time.slice(0,5)}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Host: {(booking as any).host_info?.host_name || "Unknown"}
                    </p>
                  </div>
                  <div className="text-right flex items-center gap-2">
                    <div>
                      <Badge variant={booking.status === "completed" ? "default" : "secondary"}>
                        {booking.status}
                      </Badge>
                      <p className="text-sm font-medium mt-1">${Number(booking.total_price).toFixed(2)}</p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Booking Detail Dialog */}
      <Dialog open={!!selectedBooking} onOpenChange={() => setSelectedBooking(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Trip Details</DialogTitle>
          </DialogHeader>
          {selectedBooking && (
            <div className="space-y-4">
              <div className="w-full h-48 rounded-lg overflow-hidden bg-muted">
                <img
                  src={selectedBooking.vehicles?.image_url || "/placeholder.svg"}
                  alt={selectedBooking.vehicles?.name || "Vehicle"}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.src = "/placeholder.svg";
                  }}
                />
              </div>
              
              <div>
                <h3 className="text-lg font-semibold">
                  {selectedBooking.vehicles?.brand} {selectedBooking.vehicles?.name}
                </h3>
                <p className="text-sm text-muted-foreground">
                  Hosted by {(selectedBooking as any).host_info?.host_name || "Unknown"}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Pickup</p>
                  <p className="font-medium">
                    {format(parseLocalDate(selectedBooking.start_date), "MMM d, yyyy")}
                    {selectedBooking.pickup_time ? ` at ${selectedBooking.pickup_time.slice(0,5)}` : ""}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Drop-off</p>
                  <p className="font-medium">
                    {format(parseLocalDate(selectedBooking.end_date), "MMM d, yyyy")}
                    {selectedBooking.dropoff_time ? ` at ${selectedBooking.dropoff_time.slice(0,5)}` : ""}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Pickup Location</p>
                  <p className="font-medium">{selectedBooking.pickup_location || "Not specified"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Dropoff Location</p>
                  <p className="font-medium">{selectedBooking.dropoff_location || "Not specified"}</p>
                </div>
              </div>

              <div className="flex justify-between items-center pt-4 border-t">
                <div className="flex items-center gap-2">
                  <Badge variant={selectedBooking.status === "completed" ? "default" : "secondary"}>
                    {selectedBooking.status}
                  </Badge>
                  {selectedBooking.user_rating && (
                    <div className="flex items-center gap-1">
                      {Array.from({ length: selectedBooking.user_rating.rating }).map((_, i) => (
                        <Star key={i} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Total</p>
                  <p className="text-xl font-bold text-primary">${Number(selectedBooking.total_price).toFixed(2)}</p>
                </div>
              </div>

              {/* Rate Trip Button - only for completed trips */}
              {selectedBooking.status === "completed" && (
                <Button
                  className="w-full mt-4"
                  variant={selectedBooking.user_rating ? "outline" : "default"}
                  onClick={() => {
                    setBookingToRate(selectedBooking);
                    setSelectedBooking(null);
                    setRatingDialogOpen(true);
                  }}
                >
                  <Star className="h-4 w-4 mr-2" />
                  {selectedBooking.user_rating ? "Edit Your Rating" : "Rate This Trip"}
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Rating Dialog */}
      {bookingToRate && (
        <TripRatingDialog
          open={ratingDialogOpen}
          onOpenChange={(open) => {
            setRatingDialogOpen(open);
            if (!open) setBookingToRate(null);
          }}
          bookingId={bookingToRate.id}
          vehicleName={`${bookingToRate.vehicles?.brand} ${bookingToRate.vehicles?.name}`}
          existingRating={bookingToRate.user_rating ? {
            id: bookingToRate.user_rating.id,
            rating: bookingToRate.user_rating.rating,
            review: bookingToRate.user_rating.review
          } : undefined}
        />
      )}
    </div>
  );
}
