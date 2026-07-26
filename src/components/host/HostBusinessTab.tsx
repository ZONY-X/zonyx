import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MapPin, Truck, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Json } from "@/integrations/supabase/types";
interface HostBusinessTabProps {
  hostId: string;
}
interface CustomLocation {
  name: string;
  address: string;
  fee: number;
}
export function HostBusinessTab({
  hostId
}: HostBusinessTabProps) {
  const {
    toast
  } = useToast();
  const queryClient = useQueryClient();
  const {
    data: location,
    isLoading
  } = useQuery({
    queryKey: ["host-location", hostId],
    queryFn: async () => {
      const {
        data,
        error
      } = await supabase.from("host_locations").select("*").eq("host_id", hostId).maybeSingle();
      if (error) throw error;
      return data;
    }
  });
  const [formData, setFormData] = useState({
    home_address: "",
    home_city: "",
    home_state: "",
    home_zip: "",
    delivery_enabled: false,
    delivery_radius_miles: "10",
    delivery_fee_per_mile: "0"
  });
  const [customLocations, setCustomLocations] = useState<CustomLocation[]>([]);
  const [newLocation, setNewLocation] = useState<CustomLocation>({
    name: "",
    address: "",
    fee: 0
  });

  // Update form when location data loads
  useEffect(() => {
    if (location) {
      setFormData({
        home_address: location.home_address || "",
        home_city: location.home_city || "",
        home_state: location.home_state || "",
        home_zip: location.home_zip || "",
        delivery_enabled: location.delivery_enabled || false,
        delivery_radius_miles: location.delivery_radius_miles?.toString() || "10",
        delivery_fee_per_mile: location.delivery_fee_per_mile?.toString() || "0"
      });
      setCustomLocations(Array.isArray(location.custom_locations) ? location.custom_locations as unknown as CustomLocation[] : []);
    }
  }, [location]);
  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        host_id: hostId,
        home_address: formData.home_address,
        home_city: formData.home_city,
        home_state: formData.home_state,
        home_zip: formData.home_zip,
        delivery_enabled: formData.delivery_enabled,
        delivery_radius_miles: parseInt(formData.delivery_radius_miles),
        delivery_fee_per_mile: parseFloat(formData.delivery_fee_per_mile),
        custom_locations: customLocations as unknown as Json
      };
      if (location) {
        const {
          error
        } = await supabase.from("host_locations").update(payload).eq("host_id", hostId);
        if (error) throw error;
      } else {
        const {
          error
        } = await supabase.from("host_locations").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({
        title: "Settings saved successfully"
      });
      queryClient.invalidateQueries({
        queryKey: ["host-location", hostId]
      });
    },
    onError: error => {
      toast({
        title: "Error saving settings",
        description: error.message,
        variant: "destructive"
      });
    }
  });
  const handleAddLocation = () => {
    if (!newLocation.name || !newLocation.address) return;
    setCustomLocations([...customLocations, newLocation]);
    setNewLocation({
      name: "",
      address: "",
      fee: 0
    });
  };
  const handleRemoveLocation = (index: number) => {
    setCustomLocations(customLocations.filter((_, i) => i !== index));
  };
  if (isLoading) {
    return <Card>
        <CardContent className="py-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mx-auto"></div>
        </CardContent>
      </Card>;
  }
  return <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">BUSINESS SETTINGS</h2>
        <p className="text-primary text-xs">Manage Your Location And Delivery Options</p>
      </div>

      <Tabs defaultValue="location" className="space-y-6">
        <TabsList>
          <TabsTrigger value="location" className="gap-2">
            <MapPin className="w-4 h-4" />
            Home Location
          </TabsTrigger>
          <TabsTrigger value="delivery" className="gap-2">
            <Truck className="w-4 h-4" />
            Delivery
          </TabsTrigger>
        </TabsList>

        <TabsContent value="location">
          <Card>
            <CardHeader>
              <CardTitle>Home LOCATION</CardTitle>
              <CardDescription>Set Your Primary PICK UP / DROP-OFF Location</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="home_address">Street Address</Label>
                <Input id="home_address" value={formData.home_address} onChange={e => setFormData({
                ...formData,
                home_address: e.target.value
              })} placeholder="123 Main Street" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="home_city">City</Label>
                  <Input id="home_city" value={formData.home_city} onChange={e => setFormData({
                  ...formData,
                  home_city: e.target.value
                })} placeholder="Los Angeles" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="home_state">State</Label>
                  <Input id="home_state" value={formData.home_state} onChange={e => setFormData({
                  ...formData,
                  home_state: e.target.value
                })} placeholder="CA" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="home_zip">ZIP Code</Label>
                  <Input id="home_zip" value={formData.home_zip} onChange={e => setFormData({
                  ...formData,
                  home_zip: e.target.value
                })} placeholder="90001" />
                </div>
              </div>

              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : "Save Location"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="delivery" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Delivery Settings</CardTitle>
              <CardDescription>Configure delivery options for your vehicles</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Enable Delivery</Label>
                  <p className="text-sm text-muted-foreground">Offer to deliver vehicles to renters</p>
                </div>
                <Switch checked={formData.delivery_enabled} onCheckedChange={checked => setFormData({
                ...formData,
                delivery_enabled: checked
              })} />
              </div>

              {formData.delivery_enabled && <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="delivery_radius">Delivery Radius (miles)</Label>
                      <Input id="delivery_radius" type="number" value={formData.delivery_radius_miles} onChange={e => setFormData({
                    ...formData,
                    delivery_radius_miles: e.target.value
                  })} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="delivery_fee">Fee per Mile ($)</Label>
                      <Input id="delivery_fee" type="number" step="0.01" value={formData.delivery_fee_per_mile} onChange={e => setFormData({
                    ...formData,
                    delivery_fee_per_mile: e.target.value
                  })} />
                    </div>
                  </div>
                </>}

              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : "Save Delivery Settings"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Custom Locations</CardTitle>
              <CardDescription>Add additional pickup/drop-off locations</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {customLocations.length > 0 && <div className="space-y-2">
                  {customLocations.map((loc, index) => <div key={index} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div>
                        <p className="font-medium">{loc.name}</p>
                        <p className="text-sm text-muted-foreground">{loc.address}</p>
                        {loc.fee > 0 && <p className="text-sm text-primary">${loc.fee} fee</p>}
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => handleRemoveLocation(index)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>)}
                </div>}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border rounded-lg">
                <div className="space-y-2">
                  <Label>Location Name</Label>
                  <Input value={newLocation.name} onChange={e => setNewLocation({
                  ...newLocation,
                  name: e.target.value
                })} placeholder="Airport" />
                </div>
                <div className="space-y-2">
                  <Label>Address</Label>
                  <Input value={newLocation.address} onChange={e => setNewLocation({
                  ...newLocation,
                  address: e.target.value
                })} placeholder="LAX Airport" />
                </div>
                <div className="space-y-2">
                  <Label>Fee ($)</Label>
                  <div className="flex gap-2">
                    <Input type="number" value={newLocation.fee} onChange={e => setNewLocation({
                    ...newLocation,
                    fee: parseFloat(e.target.value) || 0
                  })} placeholder="25" />
                    <Button onClick={handleAddLocation}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : "Save All"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>;
}