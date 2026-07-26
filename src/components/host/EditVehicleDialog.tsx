import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface Vehicle {
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
    name: "",
    brand: "",
    category: "",
    price_per_day: 0,
    image_url: "",
    seats: 5,
    transmission: "automatic",
    fuel_type: "Electric",
    is_available: true,
    description: "",
  });

  useEffect(() => {
    if (vehicle) {
      setFormData({
        name: vehicle.name,
        brand: vehicle.brand,
        category: vehicle.category,
        price_per_day: vehicle.price_per_day,
        image_url: vehicle.image_url,
        seats: vehicle.seats,
        transmission: vehicle.transmission,
        fuel_type: vehicle.fuel_type,
        is_available: vehicle.is_available,
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
          name: data.name,
          brand: data.brand,
          category: data.category,
          price_per_day: data.price_per_day,
          image_url: data.image_url,
          seats: data.seats,
          transmission: data.transmission,
          fuel_type: data.fuel_type,
          is_available: data.is_available,
          description: data.description || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", vehicle.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "Vehicle updated",
        description: "Your vehicle has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["host-vehicles"] });
      onSuccess();
      onOpenChange(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
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
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="brand">Brand</Label>
              <Input
                id="brand"
                value={formData.brand}
                onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Model Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Input
                id="category"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                placeholder="e.g., Electric SUV"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="price">Price per Day ($)</Label>
              <Input
                id="price"
                type="number"
                min="1"
                value={formData.price_per_day}
                onChange={(e) => setFormData({ ...formData, price_per_day: Number(e.target.value) })}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="image_url">Image URL</Label>
            <Input
              id="image_url"
              value={formData.image_url}
              onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
              placeholder="https://..."
              required
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="seats">Seats</Label>
              <Input
                id="seats"
                type="number"
                min="1"
                max="12"
                value={formData.seats}
                onChange={(e) => setFormData({ ...formData, seats: Number(e.target.value) })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="transmission">Transmission</Label>
              <Select
                value={formData.transmission}
                onValueChange={(value) => setFormData({ ...formData, transmission: value })}
              >
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
              <Select
                value={formData.fuel_type}
                onValueChange={(value) => setFormData({ ...formData, fuel_type: value })}
              >
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

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch
                id="available"
                checked={formData.is_available}
                onCheckedChange={(checked) => setFormData({ ...formData, is_available: checked })}
              />
              <Label htmlFor="available">Available for booking</Label>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
