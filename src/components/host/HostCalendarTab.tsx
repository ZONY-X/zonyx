import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Calendar, DollarSign } from "lucide-react";
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday, addDays } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
interface HostCalendarTabProps {
  hostId: string;
}
export function HostCalendarTab({
  hostId
}: HostCalendarTabProps) {
  const {
    toast
  } = useToast();
  const queryClient = useQueryClient();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [priceInput, setPriceInput] = useState("");

  // Fetch host's vehicles
  const {
    data: vehicles
  } = useQuery({
    queryKey: ["host-vehicles", hostId],
    queryFn: async () => {
      const {
        data,
        error
      } = await supabase.from("vehicles").select("id, name, brand, price_per_day").eq("host_id", hostId);
      if (error) throw error;
      return data;
    }
  });

  // Fetch pricing for selected vehicle
  const {
    data: pricing
  } = useQuery({
    queryKey: ["vehicle-pricing", selectedVehicle, format(currentMonth, "yyyy-MM")],
    queryFn: async () => {
      if (!selectedVehicle) return [];
      const start = startOfMonth(currentMonth);
      const end = endOfMonth(addMonths(currentMonth, 11)); // Get a year of pricing

      const {
        data,
        error
      } = await supabase.from("vehicle_pricing").select("*").eq("vehicle_id", selectedVehicle).gte("date", format(start, "yyyy-MM-dd")).lte("date", format(end, "yyyy-MM-dd"));
      if (error) throw error;
      return data;
    },
    enabled: !!selectedVehicle
  });
  const updatePriceMutation = useMutation({
    mutationFn: async ({
      date,
      price
    }: {
      date: string;
      price: number;
    }) => {
      if (!selectedVehicle) throw new Error("No vehicle selected");
      const {
        data: existing
      } = await supabase.from("vehicle_pricing").select("id").eq("vehicle_id", selectedVehicle).eq("date", date).maybeSingle();
      if (existing) {
        const {
          error
        } = await supabase.from("vehicle_pricing").update({
          price
        }).eq("id", existing.id);
        if (error) throw error;
      } else {
        const {
          error
        } = await supabase.from("vehicle_pricing").insert({
          vehicle_id: selectedVehicle,
          date,
          price
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({
        title: "Price updated successfully"
      });
      queryClient.invalidateQueries({
        queryKey: ["vehicle-pricing"]
      });
      setSelectedDate(null);
      setPriceInput("");
    },
    onError: error => {
      toast({
        title: "Error updating price",
        description: error.message,
        variant: "destructive"
      });
    }
  });
  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth)
  });
  const getPriceForDate = (date: Date) => {
    const dateStr = format(date, "yyyy-MM-dd");
    const priceEntry = pricing?.find(p => p.date === dateStr);
    if (priceEntry) return priceEntry.price;

    // Return default vehicle price
    const vehicle = vehicles?.find(v => v.id === selectedVehicle);
    return vehicle?.price_per_day || null;
  };
  const handleDateClick = (date: Date) => {
    if (date < new Date()) return; // Don't allow past dates
    setSelectedDate(date);
    const existingPrice = getPriceForDate(date);
    setPriceInput(existingPrice?.toString() || "");
  };
  const handleSavePrice = () => {
    if (!selectedDate || !priceInput) return;
    updatePriceMutation.mutate({
      date: format(selectedDate, "yyyy-MM-dd"),
      price: parseFloat(priceInput)
    });
  };
  return <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold uppercase">PRICING CALENDAR</h2>
        <p className="text-primary text-xs">Set Custom Daily Prices For Your Vehicles Up To A Year In Advance</p>
      </div>

      {/* Vehicle Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">SELECT VEHICLE</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedVehicle || ""} onValueChange={setSelectedVehicle}>
            <SelectTrigger className="w-full md:w-[300px]">
              <SelectValue placeholder="Choose a vehicle to manage pricing" />
            </SelectTrigger>
            <SelectContent>
              {vehicles?.map(vehicle => <SelectItem key={vehicle.id} value={vehicle.id}>
                  {vehicle.brand} {vehicle.name} (${vehicle.price_per_day}/day)
                </SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedVehicle && <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Calendar */}
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>{format(currentMonth, "MMMM yyyy")}</CardTitle>
                <CardDescription>Click a date to set a custom price</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-1 mb-2">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => <div key={day} className="text-center text-sm font-medium text-muted-foreground py-2">
                    {day}
                  </div>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({
              length: startOfMonth(currentMonth).getDay()
            }).map((_, i) => <div key={`empty-${i}`} />)}
                {days.map(day => {
              const price = getPriceForDate(day);
              const isPast = day < new Date() && !isToday(day);
              const isSelected = selectedDate && format(selectedDate, "yyyy-MM-dd") === format(day, "yyyy-MM-dd");
              return <button key={day.toISOString()} onClick={() => handleDateClick(day)} disabled={isPast} className={cn("p-2 rounded-lg text-center transition-colors min-h-[60px] flex flex-col justify-center", isPast && "opacity-50 cursor-not-allowed", !isPast && "hover:bg-muted cursor-pointer", isToday(day) && "ring-2 ring-primary", isSelected && "bg-primary text-primary-foreground")}>
                      <span className="text-sm font-medium">{format(day, "d")}</span>
                      {price && <span className="text-xs text-muted-foreground">${price}</span>}
                    </button>;
            })}
              </div>
            </CardContent>
          </Card>

          {/* Price Editor */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <DollarSign className="w-5 h-5" />
                Set Price
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedDate ? <>
                  <div className="p-4 bg-muted rounded-lg text-center">
                    <p className="text-sm text-muted-foreground">Selected Date</p>
                    <p className="text-lg font-semibold">{format(selectedDate, "EEEE, MMMM d, yyyy")}</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="price">Price per Day ($)</Label>
                    <Input id="price" type="number" value={priceInput} onChange={e => setPriceInput(e.target.value)} placeholder="Enter price" />
                  </div>
                  <Button className="w-full" onClick={handleSavePrice} disabled={!priceInput || updatePriceMutation.isPending}>
                    {updatePriceMutation.isPending ? "Saving..." : "Save Price"}
                  </Button>
                </> : <div className="text-center py-8 text-muted-foreground">
                  <Calendar className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Select a date on the calendar to set a custom price</p>
                </div>}
            </CardContent>
          </Card>
        </div>}
    </div>;
}