import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, MapPin, DollarSign } from "lucide-react";
import { format } from "date-fns";
interface HostBookingsTabProps {
  hostId: string;
}
export function HostBookingsTab({
  hostId
}: HostBookingsTabProps) {
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
          *,
          vehicles (name, brand, image_url)
        `).eq("host_id", hostId).in("status", ["pending", "confirmed", "active"]).order("start_date", {
        ascending: true
      });
      if (error) throw error;
      return data;
    }
  });
  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-amber-500/10 text-amber-500 border-amber-500/20";
      case "confirmed":
        return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      case "active":
        return "bg-green-500/10 text-green-500 border-green-500/20";
      default:
        return "bg-muted text-muted-foreground";
    }
  };
  if (isLoading) {
    return <Card>
        <CardContent className="py-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mx-auto"></div>
        </CardContent>
      </Card>;
  }
  return <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold uppercase text-primary">BOOKED TRIPS</h2>
        <p className="text-muted-foreground">View and Manage Your Active Reservations</p>
      </div>

      {bookings && bookings.length > 0 ? <div className="grid gap-4">
          {bookings.map(booking => <Card key={booking.id}>
              <CardContent className="p-4">
                <div className="flex flex-col md:flex-row md:items-center gap-4">
                  <div className="w-full md:w-32 h-20 bg-muted rounded-lg overflow-hidden">
                    <img src={booking.vehicles?.image_url || "/placeholder.svg"} alt={booking.vehicles?.name || "Vehicle"} className="w-full h-full object-cover" />
                  </div>
                  
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">
                        {booking.vehicles?.brand} {booking.vehicles?.name}
                      </h3>
                      <Badge className={getStatusColor(booking.status)}>
                        {booking.status}
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
                        ${booking.total_price}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {booking.status === "pending" && <>
                        <Button size="sm" variant="outline">Decline</Button>
                        <Button size="sm">Confirm</Button>
                      </>}
                    {booking.status === "confirmed" && <Button size="sm">Start Trip</Button>}
                    {booking.status === "active" && <Button size="sm">Complete</Button>}
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
    </div>;
}