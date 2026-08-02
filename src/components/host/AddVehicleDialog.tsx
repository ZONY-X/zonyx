import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

interface AddVehicleDialogProps {
  hostId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function AddVehicleDialog({ hostId, open, onOpenChange, onSuccess }: AddVehicleDialogProps) {
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    vehicle_identifier: "",
    brand: "",
    name: "",
    category: "Sedan",
    color: "",
    year: "2025",
    vin: "",
    plate: "",
    base_daily_rate_cents: "",
    image_url: "",
    seats: "5",
    transmission: "automatic",
    fuel_type: "Electric",
    description: "",
    is_active: true,
  });

  const addMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { error } = await supabase.from("vehicles").insert({
        host_profile_id: hostId,
        vehicle_identifier: data.vehicle_identifier,
        brand: data.brand,
        name: data.name,
        category: data.category,
        color: data.color,
        year: Number(data.year),
        vin: data.vin,
        plate: data.plate,
        base_daily_rate_cents: Number(data.base_daily_rate_cents),
        image_url: data.image_url || null,
        seats: Number(data.seats),
        transmission: data.transmission,
        fuel_type: data.fuel_type,
        description: data.description || null,
        is_active: data.is_active,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Vehicle added successfully" });
      setFormData({
        vehicle_identifier: "",
        brand: "",
        name: "",
        category: "Sedan",
        color: "",
        year: "2025",
        vin: "",
        plate: "",
        base_daily_rate_cents: "",
        image_url: "",
        seats: "5",
        transmission: "automatic",
        fuel_type: "Electric",
        description: "",
        is_active: true,
      });
      onSuccess();
    },
    onError: (error) => {
      toast({ title: "Error adding vehicle", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.vehicle_identifier || !formData.brand || !formData.name || !formData.base_daily_rate_cents) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    addMutation.mutate(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Vehicle</DialogTitle>
          <DialogDescription>Enter your vehicle details to list it on the platform</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="vehicle_identifier">Vehicle Identifier *</Label>
              <Input id="vehicle_identifier" value={formData.vehicle_identifier} onChange={(e) => setFormData({ ...formData, vehicle_identifier: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="brand">Brand *</Label>
              <Input id="brand" value={formData.brand} onChange={(e) => setFormData({ ...formData, brand: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Model Name *</Label>
              <Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Sedan">Sedan</SelectItem>
                  <SelectItem value="SUV">SUV</SelectItem>
                  <SelectItem value="Sports">Sports</SelectItem>
                  <SelectItem value="Luxury">Luxury</SelectItem>
                  <SelectItem value="Truck">Truck</SelectItem>
                  <SelectItem value="Electric">Electric</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="color">Color *</Label>
              <Input id="color" value={formData.color} onChange={(e) => setFormData({ ...formData, color: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="year">Year *</Label>
              <Input id="year" type="number" value={formData.year} onChange={(e) => setFormData({ ...formData, year: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vin">VIN *</Label>
              <Input id="vin" value={formData.vin} onChange={(e) => setFormData({ ...formData, vin: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plate">Plate *</Label>
              <Input id="plate" value={formData.plate} onChange={(e) => setFormData({ ...formData, plate: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="base_daily_rate_cents">Base Daily Rate (cents) *</Label>
              <Input id="base_daily_rate_cents" type="number" value={formData.base_daily_rate_cents} onChange={(e) => setFormData({ ...formData, base_daily_rate_cents: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="image_url">Image URL</Label>
              <Input id="image_url" value={formData.image_url} onChange={(e) => setFormData({ ...formData, image_url: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="seats">Seats</Label>
              <Input id="seats" type="number" value={formData.seats} onChange={(e) => setFormData({ ...formData, seats: e.target.value })} />
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

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={addMutation.isPending}>{addMutation.isPending ? "Adding..." : "Add Vehicle"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}