import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface Vehicle {
  id: string;
  vehicle_identifier: string;
  brand: string;
  name: string;
  category: string;
  color: string;
  year: number;
  vin: string;
  plate: string;
  base_daily_rate_cents: number;
  image_url: string | null;
  seats: number;
  transmission: string;
  fuel_type: string;
  is_active: boolean;
  description: string | null;
}

interface EditVehicleDialogProps {
  vehicle: Vehicle | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function EditVehicleDialog({ vehicle, open, onOpenChange, onSuccess }: EditVehicleDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({
    vehicle_identifier: "",
    brand: "",
    name: "",
    category: "",
    color: "",
    year: 2025,
    vin: "",
    plate: "",
    base_daily_rate_cents: 0,
    image_url: "",
    seats: 5,
    transmission: "automatic",
    fuel_type: "Electric",
    is_active: true,
    description: "",
  });

  useEffect(() => {
    if (vehicle) {
      setFormData({
        vehicle_identifier: vehicle.vehicle_identifier,
        brand: vehicle.brand,
        name: vehicle.name,
        category: vehicle.category,
        color: vehicle.color,
        year: vehicle.year,
        vin: vehicle.vin,
        plate: vehicle.plate,
        base_daily_rate_cents: vehicle.base_daily_rate_cents,
        image_url: vehicle.image_url || "",
        seats: vehicle.seats,
        transmission: vehicle.transmission,
        fuel_type: vehicle.fuel_type,
        is_active: vehicle.is_active,
        description: vehicle.description || "",
      });
    }
  }, [vehicle]);

  const updateMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (!vehicle) throw new Error("No vehicle selected");

      const { error } = await supabase
        .from("vehicles")
        .update({
          vehicle_identifier: data.vehicle_identifier,
          brand: data.brand,
          name: data.name,
          category: data.category,
          color: data.color,
          year: data.year,
          vin: data.vin,
          plate: data.plate,
          base_daily_rate_cents: data.base_daily_rate_cents,
          image_url: data.image_url || null,
          seats: data.seats,
          transmission: data.transmission,
          fuel_type: data.fuel_type,
          is_active: data.is_active,
          description: data.description || null,
        })
        .eq("id", vehicle.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Vehicle updated" });
      queryClient.invalidateQueries({ queryKey: ["host-vehicles"] });
      onSuccess();
      onOpenChange(false);
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Vehicle</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vehicle_identifier">Vehicle Identifier</Label>
            <Input id="vehicle_identifier" value={formData.vehicle_identifier} onChange={(e) => setFormData({ ...formData, vehicle_identifier: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="brand">Brand</Label>
              <Input id="brand" value={formData.brand} onChange={(e) => setFormData({ ...formData, brand: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Model Name</Label>
              <Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Input id="category" value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="color">Color</Label>
              <Input id="color" value={formData.color} onChange={(e) => setFormData({ ...formData, color: e.target.value })} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="year">Year</Label>
              <Input id="year" type="number" value={formData.year} onChange={(e) => setFormData({ ...formData, year: Number(e.target.value) })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="base_daily_rate_cents">Base Daily Rate (cents)</Label>
              <Input id="base_daily_rate_cents" type="number" value={formData.base_daily_rate_cents} onChange={(e) => setFormData({ ...formData, base_daily_rate_cents: Number(e.target.value) })} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="vin">VIN</Label>
              <Input id="vin" value={formData.vin} onChange={(e) => setFormData({ ...formData, vin: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plate">Plate</Label>
              <Input id="plate" value={formData.plate} onChange={(e) => setFormData({ ...formData, plate: e.target.value })} required />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="image_url">Image URL</Label>
            <Input id="image_url" value={formData.image_url} onChange={(e) => setFormData({ ...formData, image_url: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="seats">Seats</Label>
              <Input id="seats" type="number" value={formData.seats} onChange={(e) => setFormData({ ...formData, seats: Number(e.target.value) })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="transmission">Transmission</Label>
              <Select value={formData.transmission} onValueChange={(value) => setFormData({ ...formData, transmission: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="automatic">Automatic</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fuel_type">Fuel Type</Label>
              <Select value={formData.fuel_type} onValueChange={(value) => setFormData({ ...formData, fuel_type: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Electric">Electric</SelectItem>
                  <SelectItem value="Hybrid">Hybrid</SelectItem>
                  <SelectItem value="Gasoline">Gasoline</SelectItem>
                  <SelectItem value="Diesel">Diesel</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} rows={3} />
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" className="flex-1" disabled={updateMutation.isPending}>{updateMutation.isPending ? "Saving..." : "Save Changes"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}