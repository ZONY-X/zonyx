import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, History, ChevronRight } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useState } from "react";

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
  const { data: bookings, isLoading } = useQuery({
    queryKey: ["guest-history", guestId],
    queryFn: async () => {
      if (!guestId) return [];

      const { data, error } = await supabase
        .from("bookings")
        .select(`
          id,
          start_date,
          end_date,
          pickup_location,
          dropoff_location,
          trip_status,
          grand_total_cents,
          vehicles (model, brand, image_url)
        `)
        .eq("renter_profile_id", guestId)
        .in("trip_status", ["completed", "cancelled"])
        .order("end_date", { ascending: false });

      if (error) {
        console.error("Error fetching history:", error);
        return [];
      }

      return data;
    },
    enabled: !!guestId,
  });

  const totalSpent = bookings?.reduce((sum, b) => 
    b.trip_status === "completed" ? sum + Number(b.grand_total_cents || 0) : sum, 0
  ) || 0;

  const completedTrips = bookings?.filter(b => b.trip_status === "completed").length || 0;

  const formatStatus = (status: string) => status.replace(/_/g, " ");

  const [selectedBooking, setSelectedBooking] = useState<any>(null);

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
            <p className="text-2xl font-bold text-primary">${(totalSpent / 100).toFixed(2)}</p>
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
                      alt={booking.vehicles?.model || "Vehicle"}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {booking.vehicles?.brand} {booking.vehicles?.model}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {format(parseLocalDate(booking.start_date), "MMM d, yyyy")} - {format(parseLocalDate(booking.end_date), "MMM d, yyyy")}
                    </p>
                  </div>
                  <div className="text-right flex items-center gap-2">
                    <div>
                      <Badge variant={booking.trip_status === "completed" ? "default" : "secondary"}>
                        {formatStatus(booking.trip_status)}
                      </Badge>
                      <p className="text-sm font-medium mt-1">${(Number(booking.grand_total_cents || 0) / 100).toFixed(2)}</p>
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
                  alt={selectedBooking.vehicles?.model || "Vehicle"}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.src = "/placeholder.svg";
                  }}
                />
              </div>
              
              <div>
                <h3 className="text-lg font-semibold">
                  {selectedBooking.vehicles?.brand} {selectedBooking.vehicles?.model}
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Pickup</p>
                  <p className="font-medium">
                    {format(parseLocalDate(selectedBooking.start_date), "MMM d, yyyy")}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Drop-off</p>
                  <p className="font-medium">
                    {format(parseLocalDate(selectedBooking.end_date), "MMM d, yyyy")}
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
                  <Badge variant={selectedBooking.trip_status === "completed" ? "default" : "secondary"}>
                    {formatStatus(selectedBooking.trip_status)}
                  </Badge>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Total</p>
                  <p className="text-xl font-bold text-primary">${(Number(selectedBooking.grand_total_cents || 0) / 100).toFixed(2)}</p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
