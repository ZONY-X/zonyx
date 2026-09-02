import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Car, MapPin, Calendar } from "lucide-react";
import { format } from "date-fns";
import { isPastReservation } from "@/lib/reservationTime";

interface GuestBookingsTabProps {
  guestId: string;
}

export function GuestBookingsTab({ guestId }: GuestBookingsTabProps) {
  const { data: bookings, isLoading } = useQuery({
    queryKey: ["guest-bookings", guestId],
    queryFn: async () => {
      if (!guestId) return [];
      
      const { data, error } = await supabase
        .from("bookings")
        .select(`
          id,
          start_date,
          end_date,
          pickup_location,
          dropoff_time,
          trip_status,
          grand_total_cents,
          vehicles (model, brand, image_url)
        `)
        .eq("renter_profile_id", guestId)
        .order("start_date", { ascending: true });

      if (error) {
        console.error("Error fetching bookings:", error);
        return [];
      }
      return (data ?? []).filter((booking) => {
        const activeStatuses = ["pending_payment", "confirmed", "active", "pending_inspection"];
        return activeStatuses.includes(booking.trip_status) && !isPastReservation(booking.end_date, booking.dropoff_time);
      });
    },
    enabled: !!guestId,
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending_payment": return "bg-yellow-500/10 text-yellow-600 border-yellow-500/20";
      case "confirmed": return "bg-blue-500/10 text-blue-600 border-blue-500/20";
      case "active": return "bg-green-500/10 text-green-600 border-green-500/20";
      case "pending_inspection": return "bg-violet-500/10 text-violet-600 border-violet-500/20";
      default: return "bg-gray-500/10 text-gray-600 border-gray-500/20";
    }
  };

  const formatStatus = (status: string) => status.replace(/_/g, " ");

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (!bookings || bookings.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Car className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground text-center">No active bookings</p>
          <Button className="mt-4" variant="outline" asChild>
            <a href="/fleet">Browse Vehicles</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {bookings.map((booking) => (
        <Card key={booking.id}>
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row gap-4">
              {/* Vehicle Image */}
              <div className="w-full md:w-48 h-32 rounded-lg overflow-hidden bg-muted">
                <img
                  src={booking.vehicles?.image_url || "/placeholder.svg"}
                  alt={booking.vehicles?.model || "Vehicle"}
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Booking Details */}
              <div className="flex-1 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-lg">
                      {booking.vehicles?.brand} {booking.vehicles?.model}
                    </h3>
                    <Badge className={getStatusColor(booking.trip_status || "pending_payment")}>
                      {formatStatus(booking.trip_status || "pending_payment")}
                    </Badge>
                  </div>
                  <p className="text-xl font-bold text-primary">
                    ${(Number(booking.grand_total_cents || 0) / 100).toFixed(2)}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    <span>
                      {format(new Date(booking.start_date), "MMM d")} - {format(new Date(booking.end_date), "MMM d, yyyy")}
                    </span>
                  </div>
                  {booking.pickup_location && (
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      <span>{booking.pickup_location}</span>
                    </div>
                  )}
                </div>

                {booking.trip_status === "pending_payment" && (
                  <div className="flex gap-2 mt-4">
                    <Button variant="outline" size="sm" disabled>Awaiting Payment</Button>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
