import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Car, FileText, Edit } from "lucide-react";
import { VehicleDocumentsDialog } from "./VehicleDocumentsDialog";
import { AddVehicleDialog } from "./AddVehicleDialog";
import { EditVehicleDialog } from "./EditVehicleDialog";
interface HostVehiclesTabProps {
  hostId: string;
}
interface VehicleData {
  id: string;
  name: string;
  brand: string;
  category: string;
  price_per_day: number;
  image_url: string;
  seats: number;
  transmission: string;
  fuel_type: string;
  is_available: boolean;
  description: string | null;
}
export function HostVehiclesTab({
  hostId
}: HostVehiclesTabProps) {
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [editingVehicle, setEditingVehicle] = useState<VehicleData | null>(null);
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const {
    data: vehicles,
    isLoading,
    refetch
  } = useQuery({
    queryKey: ["host-vehicles", hostId],
    queryFn: async () => {
      const {
        data,
        error
      } = await supabase.from("vehicles").select("*").eq("host_id", hostId).order("created_at", {
        ascending: false
      });
      if (error) throw error;
      return data;
    }
  });
  if (isLoading) {
    return <Card>
        <CardContent className="py-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mx-auto"></div>
        </CardContent>
      </Card>;
  }
  return <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">YOUR VEHICLES</h2>
          <p className="text-primary text-xs">Manage Your Fleet And Documentation</p>
        </div>
        <Button onClick={() => setShowAddVehicle(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Vehicle
        </Button>
      </div>

      {vehicles && vehicles.length > 0 ? <div className="grid gap-4">
          {vehicles.map(vehicle => <Card key={vehicle.id} className="overflow-hidden">
              <div className="flex flex-col md:flex-row">
                <div className="w-full md:w-48 h-32 bg-muted">
                  <img src={vehicle.image_url} alt={vehicle.name} className="w-full h-full object-cover" />
                </div>
                <CardContent className="flex-1 p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-lg">{vehicle.brand} {vehicle.name}</h3>
                      <p className="text-muted-foreground text-sm">{vehicle.category}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant={vehicle.is_available ? "default" : "secondary"}>
                          {vehicle.is_available ? "Available" : "Unavailable"}
                        </Badge>
                        <span className="text-sm font-medium">${vehicle.price_per_day}/day</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setSelectedVehicleId(vehicle.id)}>
                        <FileText className="w-4 h-4 mr-2" />
                        Documents
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setEditingVehicle(vehicle)}>
                        <Edit className="w-4 h-4 mr-2" />
                        Edit
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </div>
            </Card>)}
        </div> : <Card>
          <CardContent className="py-12 text-center">
            <Car className="w-12 h-12 text-primary mx-auto mb-4" />
            <h3 className="font-semibold mb-2 text-xl">NO VEHICLES YET </h3>
            <p className="mb-4 text-primary text-xs">
              Add Your First Vehicle To Start Earning
            </p>
            <Button onClick={() => setShowAddVehicle(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Vehicle
            </Button>
          </CardContent>
        </Card>}

      <VehicleDocumentsDialog vehicleId={selectedVehicleId} open={!!selectedVehicleId} onOpenChange={open => !open && setSelectedVehicleId(null)} />

      <AddVehicleDialog hostId={hostId} open={showAddVehicle} onOpenChange={setShowAddVehicle} onSuccess={() => {
      refetch();
      setShowAddVehicle(false);
    }} />

      <EditVehicleDialog vehicle={editingVehicle} open={!!editingVehicle} onOpenChange={open => !open && setEditingVehicle(null)} onSuccess={() => refetch()} />
    </div>;
}