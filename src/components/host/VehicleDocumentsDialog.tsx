import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";

interface VehicleDocumentsDialogProps {
  vehicleId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VehicleDocumentsDialog({ vehicleId, open, onOpenChange }: VehicleDocumentsDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [formData, setFormData] = useState({
    registration_number: "",
    plate_number: "",
    vin_number: "",
    insurance_provider: "",
    insurance_policy_number: "",
    insurance_expiry: "",
    drivers_license_number: "",
    drivers_license_expiry: "",
  });

  const { data: documents, isLoading } = useQuery({
    queryKey: ["vehicle-documents", vehicleId],
    queryFn: async () => {
      if (!vehicleId) return null;
      const { data, error } = await supabase
        .from("vehicle_documents")
        .select("*")
        .eq("vehicle_id", vehicleId)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!vehicleId && open,
  });

  useEffect(() => {
    if (documents) {
      setFormData({
        registration_number: documents.registration_number || "",
        plate_number: documents.plate_number || "",
        vin_number: documents.vin_number || "",
        insurance_provider: documents.insurance_provider || "",
        insurance_policy_number: documents.insurance_policy_number || "",
        insurance_expiry: documents.insurance_expiry || "",
        drivers_license_number: documents.drivers_license_number || "",
        drivers_license_expiry: documents.drivers_license_expiry || "",
      });
    } else {
      setFormData({
        registration_number: "",
        plate_number: "",
        vin_number: "",
        insurance_provider: "",
        insurance_policy_number: "",
        insurance_expiry: "",
        drivers_license_number: "",
        drivers_license_expiry: "",
      });
    }
  }, [documents]);

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (!vehicleId) throw new Error("No vehicle selected");

      if (documents) {
        const { error } = await supabase
          .from("vehicle_documents")
          .update(data)
          .eq("vehicle_id", vehicleId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("vehicle_documents")
          .insert({ ...data, vehicle_id: vehicleId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: "Documents saved successfully" });
      queryClient.invalidateQueries({ queryKey: ["vehicle-documents", vehicleId] });
      onOpenChange(false);
    },
    onError: (error) => {
      toast({ title: "Error saving documents", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Vehicle Documents</DialogTitle>
          <DialogDescription>
            Manage registration, insurance, and ownership documents
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mx-auto"></div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="registration_number">Registration Number</Label>
                <Input
                  id="registration_number"
                  value={formData.registration_number}
                  onChange={(e) => setFormData({ ...formData, registration_number: e.target.value })}
                  placeholder="Enter registration number"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="plate_number">Plate Number</Label>
                <Input
                  id="plate_number"
                  value={formData.plate_number}
                  onChange={(e) => setFormData({ ...formData, plate_number: e.target.value })}
                  placeholder="Enter plate number"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="vin_number">VIN Number</Label>
                <Input
                  id="vin_number"
                  value={formData.vin_number}
                  onChange={(e) => setFormData({ ...formData, vin_number: e.target.value })}
                  placeholder="Enter VIN number"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="drivers_license_number">Driver's License Number</Label>
                <Input
                  id="drivers_license_number"
                  value={formData.drivers_license_number}
                  onChange={(e) => setFormData({ ...formData, drivers_license_number: e.target.value })}
                  placeholder="Enter license number"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="drivers_license_expiry">License Expiry Date</Label>
                <Input
                  id="drivers_license_expiry"
                  type="date"
                  value={formData.drivers_license_expiry}
                  onChange={(e) => setFormData({ ...formData, drivers_license_expiry: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="insurance_provider">Insurance Provider</Label>
                <Input
                  id="insurance_provider"
                  value={formData.insurance_provider}
                  onChange={(e) => setFormData({ ...formData, insurance_provider: e.target.value })}
                  placeholder="Enter insurance provider"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="insurance_policy_number">Insurance Policy Number</Label>
                <Input
                  id="insurance_policy_number"
                  value={formData.insurance_policy_number}
                  onChange={(e) => setFormData({ ...formData, insurance_policy_number: e.target.value })}
                  placeholder="Enter policy number"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="insurance_expiry">Insurance Expiry Date</Label>
                <Input
                  id="insurance_expiry"
                  type="date"
                  value={formData.insurance_expiry}
                  onChange={(e) => setFormData({ ...formData, insurance_expiry: e.target.value })}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : "Save Documents"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
