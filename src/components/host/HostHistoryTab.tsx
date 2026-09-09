import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { History, DollarSign, TrendingUp } from "lucide-react";
import { format, parseISO } from "date-fns";
import { isPastReservation } from "@/lib/reservationTime";
import { BookingFinancialSummary } from "@/components/booking/BookingFinancialSummary";
import { useState } from "react";
import { BookingReadModel } from "@/lib/bookingReadModel";
import { AfterTripChargesPanel } from "@/components/booking/AfterTripChargesPanel";
import { Link } from "react-router-dom";
interface HostHistoryTabProps {
  hostId: string;
}
export function HostHistoryTab({
  hostId
}: HostHistoryTabProps) {
  const [financialBooking, setFinancialBooking] = useState<(BookingReadModel & { grand_total_cents: number; vehicles: { model: string; brand: string } }) | null>(null);
  const {
    data: history,
    isLoading
  } = useQuery({
    queryKey: ["host-history", hostId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_booking_operational_read_model");
      if (error) throw error;
      return ((data ?? []) as BookingReadModel[]).filter((booking) => booking.host_profile_id === hostId).sort((a, b) => b.end_date.localeCompare(a.end_date)).filter((booking) => {
        return booking.trip_status === "completed" || booking.trip_status === "cancelled" || isPastReservation(booking.end_date, booking.dropoff_time);
      }).map((booking) => ({ ...booking, grand_total_cents: booking.displayed_total_cents, vehicles: { model: booking.vehicle_model, brand: booking.vehicle_brand } }));
    }
  });
  const totalEarnings = history?.reduce((sum, booking) => booking.trip_status === "completed" ? sum + Number(booking.grand_total_cents || 0) : sum, 0) || 0;
  const completedTrips = history?.filter(b => b.trip_status === "completed").length || 0;

  const formatStatus = (status: string) => status.replace(/_/g, " ");
  if (isLoading) {
    return <Card>
        <CardContent className="py-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mx-auto"></div>
        </CardContent>
      </Card>;
  }
  return <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Trip History</h2>
        <p className="text-muted-foreground">View past trips and earnings</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-green-500/10 flex items-center justify-center">
              <DollarSign className="w-6 h-6 text-green-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Earnings</p>
              <p className="text-2xl font-bold text-primary">${(totalEarnings / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Completed Trips</p>
              <p className="text-2xl font-bold text-primary">{completedTrips}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <History className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Trips</p>
              <p className="text-2xl font-bold text-primary">{history?.length || 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* History Table */}
      {history && history.length > 0 ? <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Earnings</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map(booking => <TableRow key={booking.id}>
                    <TableCell className="font-medium">
                      {booking.vehicles?.brand} {booking.vehicles?.model}
                    </TableCell>
                    <TableCell>
                      {format(parseISO(booking.start_date), "MMM d")} - {format(parseISO(booking.end_date), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>${(Number(booking.grand_total_cents || 0) / 100).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant={booking.trip_status === "completed" ? "default" : "secondary"}>
                        {formatStatus(booking.trip_status)}
                      </Badge>
                      <Button type="button" variant="ghost" size="sm" className="ml-2" onClick={() => setFinancialBooking(booking)}>Financials</Button>{booking.is_financially_reconciled && <Button type="button" variant="ghost" size="sm" asChild><Link to={`/trip/${booking.id}/receipt`}>Receipt</Link></Button>}
                    </TableCell>
                  </TableRow>)}
              </TableBody>
            </Table>
          </CardContent>
        </Card> : <Card>
          <CardContent className="py-12 text-center">
            <History className="w-12 h-12 text-primary mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">NO TRIP HISTORY YET </h3>
            <p className="text-primary text-xs">
              Completed Trips Will Appear Here
            </p>
          </CardContent>
        </Card>}
      {financialBooking && <div className="space-y-2"><Button type="button" size="sm" variant="ghost" onClick={() => setFinancialBooking(null)}>Close financials</Button><BookingFinancialSummary bookingId={financialBooking.id} /><AfterTripChargesPanel bookingId={financialBooking.id} canSubmit={financialBooking.is_financially_reconciled && (financialBooking.trip_status === "pending_inspection" || financialBooking.trip_status === "completed")} /></div>}
    </div>;
}