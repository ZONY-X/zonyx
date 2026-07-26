import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { History, DollarSign, TrendingUp } from "lucide-react";
import { format } from "date-fns";
interface HostHistoryTabProps {
  hostId: string;
}
export function HostHistoryTab({
  hostId
}: HostHistoryTabProps) {
  const {
    data: history,
    isLoading
  } = useQuery({
    queryKey: ["host-history", hostId],
    queryFn: async () => {
      const {
        data,
        error
      } = await supabase.from("bookings").select(`
          *,
          vehicles (name, brand)
        `).eq("host_id", hostId).in("status", ["completed", "cancelled"]).order("end_date", {
        ascending: false
      });
      if (error) throw error;
      return data;
    }
  });
  const totalEarnings = history?.reduce((sum, booking) => booking.status === "completed" ? sum + Number(booking.total_price) : sum, 0) || 0;
  const completedTrips = history?.filter(b => b.status === "completed").length || 0;
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
              <p className="text-2xl font-bold text-primary">${totalEarnings.toLocaleString()}</p>
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
                      {booking.vehicles?.brand} {booking.vehicles?.name}
                    </TableCell>
                    <TableCell>
                      {format(new Date(booking.start_date), "MMM d")} - {format(new Date(booking.end_date), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>${booking.total_price}</TableCell>
                    <TableCell>
                      <Badge variant={booking.status === "completed" ? "default" : "secondary"}>
                        {booking.status}
                      </Badge>
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
    </div>;
}