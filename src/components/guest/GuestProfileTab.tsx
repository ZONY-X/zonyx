import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { User } from "lucide-react";

interface Profile {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
}

interface GuestProfileTabProps {
  userId: string;
  guest?: Profile | null;
  isNewGuest?: boolean;
}

export function GuestProfileTab({ userId, guest, isNewGuest = false }: GuestProfileTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    full_name: "",
    email: "",
    phone: "",
    avatar_url: "",
  });

  useEffect(() => {
    if (guest) {
      setFormData({
        full_name: guest.full_name || "",
        email: guest.email || "",
        phone: guest.phone || "",
        avatar_url: guest.avatar_url || "",
      });
    }
  }, [guest]);

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const payload = {
        full_name: data.full_name,
        email: data.email,
        phone: data.phone || null,
        avatar_url: data.avatar_url || null,
      };

      if (isNewGuest || !guest) {
        const { error } = await supabase.from("profiles").insert({
          user_id: userId,
          ...payload,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("profiles").update(payload).eq("id", guest.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: isNewGuest ? "Profile created!" : "Profile updated!" });
      queryClient.invalidateQueries({ queryKey: ["guest", userId] });
    },
    onError: (error) => {
      console.error("Error saving profile:", error);
      toast({ title: "Failed to save profile", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.full_name.trim() || !formData.email.trim()) {
      toast({ title: "Name and email are required", variant: "destructive" });
      return;
    }
    saveMutation.mutate(formData);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-center gap-2 uppercase">
            Profile
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-4">
            <Avatar className="h-24 w-24 border-4 border-primary/20">
              <AvatarImage src={formData.avatar_url || undefined} alt="Profile" />
              <AvatarFallback className="bg-primary/10">
                <User className="h-12 w-12 text-primary" />
              </AvatarFallback>
            </Avatar>
            <div className="w-full space-y-2">
              <Label htmlFor="avatar_url">Avatar URL</Label>
              <Input
                id="avatar_url"
                value={formData.avatar_url}
                onChange={(e) => setFormData({ ...formData, avatar_url: e.target.value })}
                placeholder="https://..."
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="uppercase">Account Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="full_name">Full Name *</Label>
              <Input
                id="full_name"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>

            <Button type="submit" className="w-full" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving..." : isNewGuest ? "Create Profile" : "Save Changes"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}