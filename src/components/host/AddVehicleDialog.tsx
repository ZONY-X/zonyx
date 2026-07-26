import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
    name: "",
    brand: "",
    category: "Sedan",
    price_per_day: "",
    seats: "5",
    transmission: "automatic",
    fuel_type: "Electric",
    description: "",
    image_url: "",
  });

  const addMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { error } = await supabase
        .from("vehicles")
        .insert({
          host_id: hostId,
          name: data.name,
          brand: data.brand,
          category: data.category,
          price_per_day: parseInt(data.price_per_day),
          seats: parseInt(data.seats),
          transmission: data.transmission,
          fuel_type: data.fuel_type,
          description: data.description,
          image_url: data.image_url || "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=800",
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Vehicle added successfully" });
      setFormData({
        name: "",
        brand: "",
        category: "Sedan",
        price_per_day: "",
        seats: "5",
        transmission: "automatic",
        fuel_type: "Electric",
        description: "",
        image_url: "",
      });
      onSuccess();
    },
    onError: (error) => {
      toast({ title: "Error adding vehicle", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.brand || !formData.price_per_day) {
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
          <DialogDescription>
            Enter your vehicle details to list it on the platform
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="brand">Brand *</Label>
              <Input
                id="brand"
                value={formData.brand}
                onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                placeholder="e.g., Tesla, BMW, Porsche"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Model Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Model 3, M4, Cayenne"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
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
              <Label htmlFor="price_per_day">Price per Day ($) *</Label>
              <Input
                id="price_per_day"
                type="number"
                value={formData.price_per_day}
                onChange={(e) => setFormData({ ...formData, price_per_day: e.target.value })}
                placeholder="150"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="seats">Seats</Label>
              <Select value={formData.seats} onValueChange={(value) => setFormData({ ...formData, seats: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="4">4</SelectItem>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="7">7</SelectItem>
                  <SelectItem value="8">8</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="transmission">Transmission</Label>
              <Select value={formData.transmission} onValueChange={(value) => setFormData({ ...formData, transmission: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="automatic">Automatic</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="fuel_type">Fuel Type</Label>
              <Select value={formData.fuel_type} onValueChange={(value) => setFormData({ ...formData, fuel_type: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Electric">Electric</SelectItem>
                  <SelectItem value="Hybrid">Hybrid</SelectItem>
                  <SelectItem value="Gasoline">Gasoline</SelectItem>
                  <SelectItem value="Diesel">Diesel</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="image_url">Image URL</Label>
              <Input
                id="image_url"
                value={formData.image_url}
                onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
                placeholder="https://example.com/car.jpg"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Describe your vehicle..."
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={addMutation.isPending}>
              {addMutation.isPending ? "Adding..." : "Add Vehicle"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
