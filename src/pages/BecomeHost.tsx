import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { useAuth } from "@/hooks/useAuth";
import { useHost } from "@/hooks/useHost";
import { Navigate, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Car, Shield } from "lucide-react";

export default function BecomeHost() {
  const { user, loading: authLoading } = useAuth();
  const { host, isLoading: hostLoading, refetch } = useHost();
  const { toast } = useToast();
  const navigate = useNavigate();

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("You must be logged in");

      const { error } = await supabase
        .from("profiles")
        .update({ is_host: true })
        .eq("user_id", user.id);

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
    applyMutation.mutate();
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
            <Card>
              <CardContent className="pt-6 text-center">
                <Shield className="w-10 h-10 text-primary mx-auto mb-3" />
                <h3 className="font-semibold mb-1">Protected Rentals</h3>
                <p className="text-sm text-muted-foreground">Booking-first flow with host-controlled vehicles</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <Car className="w-10 h-10 text-primary mx-auto mb-3" />
                <h3 className="font-semibold mb-1">Fleet Access</h3>
                <p className="text-sm text-muted-foreground">Publish vehicles directly from your profile</p>
              </CardContent>
            </Card>
          </div>

          {/* Host enablement */}
          <Card>
            <CardHeader>
              <CardTitle>Host Access</CardTitle>
              <CardDescription>Enable host mode on your profile to manage vehicles and bookings.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <Button type="submit" size="lg" className="w-full" disabled={applyMutation.isPending}>
                  {applyMutation.isPending ? "Enabling..." : "Enable Host Mode"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </MainLayout>
  );
}
