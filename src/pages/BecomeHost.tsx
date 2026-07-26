import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { useAuth } from "@/hooks/useAuth";
import { useHost } from "@/hooks/useHost";
import { Navigate, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Car, DollarSign, Users, Shield } from "lucide-react";

export default function BecomeHost() {
  const { user, loading: authLoading } = useAuth();
  const { host, isLoading: hostLoading, refetch } = useHost();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    host_name: "",
    bio: "",
  });

  const applyMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (!user) throw new Error("You must be logged in");

      const { error } = await supabase.from("hosts").insert({
        user_id: user.id,
        host_name: data.host_name,
        bio: data.bio,
        is_approved: false,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Application submitted successfully!" });
      refetch();
      navigate("/host-dashboard");
    },
    onError: (error) => {
      toast({ title: "Error submitting application", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.host_name.trim()) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    applyMutation.mutate(formData);
  };

  if (authLoading || hostLoading) {
    return (
      <MainLayout>
        <div className="container py-24 min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
        </div>
      </MainLayout>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (host) {
    return <Navigate to="/host-dashboard" replace />;
  }

  return (
    <MainLayout>
      <div className="container py-24 min-h-screen">
        <div className="max-w-4xl mx-auto">
          {/* Hero Section */}
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-bold mb-4">
              Become a Host
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Share your vehicle and earn money. Join our community of trusted hosts.
            </p>
          </div>

          {/* Benefits */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
            <Card>
              <CardContent className="pt-6 text-center">
                <DollarSign className="w-10 h-10 text-primary mx-auto mb-3" />
                <h3 className="font-semibold mb-1">Earn Extra Income</h3>
                <p className="text-sm text-muted-foreground">Turn your car into a money-making asset</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <Shield className="w-10 h-10 text-primary mx-auto mb-3" />
                <h3 className="font-semibold mb-1">Protected Rentals</h3>
                <p className="text-sm text-muted-foreground">Insurance coverage on every trip</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <Car className="w-10 h-10 text-primary mx-auto mb-3" />
                <h3 className="font-semibold mb-1">Your Schedule</h3>
                <p className="text-sm text-muted-foreground">Set your own availability and pricing</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <Users className="w-10 h-10 text-primary mx-auto mb-3" />
                <h3 className="font-semibold mb-1">Community</h3>
                <p className="text-sm text-muted-foreground">Join thousands of trusted hosts</p>
              </CardContent>
            </Card>
          </div>

          {/* Application Form */}
          <Card>
            <CardHeader>
              <CardTitle>Host Application</CardTitle>
              <CardDescription>
                Fill out the form below to apply as a host. We'll review your application within 24-48 hours.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="host_name">Display Name *</Label>
                  <Input
                    id="host_name"
                    value={formData.host_name}
                    onChange={(e) => setFormData({ ...formData, host_name: e.target.value })}
                    placeholder="Your name or business name"
                    required
                    maxLength={100}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bio">Tell us about yourself</Label>
                  <Textarea
                    id="bio"
                    value={formData.bio}
                    onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                    placeholder="Share why you want to become a host and any relevant experience..."
                    rows={4}
                  />
                </div>

                <Button type="submit" size="lg" className="w-full" disabled={applyMutation.isPending}>
                  {applyMutation.isPending ? "Submitting..." : "Submit Application"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </MainLayout>
  );
}
