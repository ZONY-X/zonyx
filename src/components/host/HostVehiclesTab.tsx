import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Car, Edit, ArrowUp, ArrowDown } from "lucide-react";
import { AddVehicleDialog } from "./AddVehicleDialog";
import { EditVehicleDialog } from "./EditVehicleDialog";

interface HostVehiclesTabProps {
  hostId: string;
}

interface VehicleRow {
  id: string;
  brand: string;
  name: string;
  category: string;
  color: string;
  year: number;
  image_url: string | null;
  base_daily_rate_cents: number;
  is_active: boolean;
  vehicle_identifier: string;
  description: string | null;
  seats: number;
  transmission: string;
  fuel_type: string;
  vin: string;
  plate: string;
  display_order: number | null;
}

function formatCurrencyFromCents(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
}

export function HostVehiclesTab({ hostId }: HostVehiclesTabProps) {
  const [editingVehicle, setEditingVehicle] = useState<VehicleRow | null>(null);
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const queryClient = useQueryClient();

  const { data: vehicles, isLoading, refetch } = useQuery({
    queryKey: ["host-vehicles", hostId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("*")
        .eq("host_profile_id", hostId)
        .order("display_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as VehicleRow[];
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async ({ fromIndex, direction }: { fromIndex: number; direction: "up" | "down" }) => {
      if (!vehicles) return;
      const targetIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;
      if (targetIndex < 0 || targetIndex >= vehicles.length) return;

      const reordered = [...vehicles];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(targetIndex, 0, moved);

      // Renumber the visible list 1..N and persist only rows whose value changed.
      const updates = reordered
        .map((vehicle, index) => ({ id: vehicle.id, display_order: index + 1 }))
        .filter((update) => {
          const previous = vehicles.find((v) => v.id === update.id)?.display_order;
          return previous !== update.display_order;
        });

      for (const update of updates) {
        const { error } = await supabase
          .from("vehicles")
          .update({ display_order: update.display_order })
          .eq("id", update.id);
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["host-vehicles", hostId] }),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mx-auto"></div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">YOUR VEHICLES</h2>
          <p className="text-primary text-xs">Manage your launch fleet</p>
        </div>
        <Button onClick={() => setShowAddVehicle(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Vehicle
        </Button>
      </div>

      {vehicles && vehicles.length > 0 ? (
        <div className="grid gap-4">
          {vehicles.map((vehicle) => (
            <Card key={vehicle.id} className="overflow-hidden">
              <div className="flex flex-col md:flex-row">
                <div className="w-full md:w-48 h-32 bg-muted">
                  <img src={vehicle.image_url || "/placeholder.svg"} alt={`${vehicle.brand} ${vehicle.name}`} className="w-full h-full object-cover" />
                </div>
                <CardContent className="flex-1 p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-lg">{vehicle.year} {vehicle.brand} {vehicle.name}</h3>
                      <p className="text-muted-foreground text-sm">{vehicle.category} • {vehicle.color}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant={vehicle.is_active ? "default" : "secondary"}>
                          {vehicle.is_active ? "Active" : "Inactive"}
                        </Badge>
                        <span className="text-sm font-medium">{formatCurrencyFromCents(vehicle.base_daily_rate_cents)}/day</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {vehicles && vehicles.length > 1 && (
                        <div className="flex flex-col gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`Move ${vehicle.year} ${vehicle.brand} ${vehicle.name} up`}
                            disabled={reorderMutation.isPending || vehicle === vehicles[0]}
                            onClick={() => reorderMutation.mutate({ fromIndex: vehicles.indexOf(vehicle), direction: "up" })}
                          >
                            <ArrowUp className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`Move ${vehicle.year} ${vehicle.brand} ${vehicle.name} down`}
                            disabled={reorderMutation.isPending || vehicle === vehicles[vehicles.length - 1]}
                            onClick={() => reorderMutation.mutate({ fromIndex: vehicles.indexOf(vehicle), direction: "down" })}
                          >
                            <ArrowDown className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                      <Button variant="outline" size="sm" onClick={() => setEditingVehicle(vehicle)}>
                        <Edit className="w-4 h-4 mr-2" />
                        Edit
                      </Button>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">ID: {vehicle.vehicle_identifier}</p>
                </CardContent>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Car className="w-12 h-12 text-primary mx-auto mb-4" />
            <h3 className="font-semibold mb-2 text-xl">No vehicles yet</h3>
            <p className="mb-4 text-primary text-xs">Add your first vehicle to start earning</p>
            <Button onClick={() => setShowAddVehicle(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Vehicle
            </Button>
          </CardContent>
        </Card>
      )}

      <AddVehicleDialog
        hostId={hostId}
        open={showAddVehicle}
        onOpenChange={setShowAddVehicle}
        onSuccess={() => {
          refetch();
          setShowAddVehicle(false);
        }}
      />

      <EditVehicleDialog
        vehicle={editingVehicle}
        open={!!editingVehicle}
        onOpenChange={(open) => !open && setEditingVehicle(null)}
        onSuccess={() => refetch()}
      />
    </div>
  );
}