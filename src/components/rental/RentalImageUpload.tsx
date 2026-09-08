import { ImageUploadDropzone } from "./ImageUploadDropzone";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface RentalImageUploadProps {
  showBefore?: boolean;
  showAfter?: boolean;
  userRole: "guest" | "host";
  profileId: string;
}

export function RentalImageUpload({ showBefore = true, showAfter = true, userRole, profileId }: RentalImageUploadProps) {
  const [bookingId, setBookingId] = useState("");
  const { data: bookings = [] } = useQuery({
    queryKey: ["condition-photo-bookings", userRole, profileId],
    queryFn: async () => {
      const ownerColumn = userRole === "guest" ? "renter_profile_id" : "host_profile_id";
      const { data, error } = await supabase.from("bookings")
        .select("id, reservation_number, start_date, vehicles(brand, model)")
        .eq(ownerColumn, profileId)
        .in("trip_status", ["confirmed", "active", "pending_inspection", "completed"])
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-xl uppercase text-center">VEHICLE CONDITION PHOTOS</CardTitle>
        <CardDescription className="text-center">
          Upload photos documenting the vehicle's condition before and after your rental
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor={`condition-photo-booking-${userRole}`}>Trip / booking</Label>
          <Select value={bookingId} onValueChange={setBookingId}>
            <SelectTrigger id={`condition-photo-booking-${userRole}`}><SelectValue placeholder="Select a trip" /></SelectTrigger>
            <SelectContent>{bookings.map((booking) => <SelectItem key={booking.id} value={booking.id}>{booking.reservation_number} · {booking.vehicles?.brand} {booking.vehicles?.model}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {!bookingId ? <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">Select a trip to view or upload its condition photos.</p> : <>
        {showBefore && (
          <ImageUploadDropzone
            type="before"
            userRole={userRole}
            bookingId={bookingId}
            profileId={profileId}
          />
        )}
        {showAfter && (
          <ImageUploadDropzone
            type="after"
            userRole={userRole}
            bookingId={bookingId}
            profileId={profileId}
          />
        )}</>}
      </CardContent>
    </Card>
  );
}
