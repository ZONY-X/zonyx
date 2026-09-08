import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { Car, ClipboardList, Tag, Users } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { AccountModeGuard } from "@/components/account/AccountModeGuard";
import { HostBookingsTab } from "@/components/host/HostBookingsTab";
import { HostVehiclesTab } from "@/components/host/HostVehiclesTab";
import { PromoCodesTab } from "@/components/host/PromoCodesTab";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAccountMode } from "@/contexts/AccountModeContext";

export default function AdminDashboard() {
  const { capabilities, allowedModes } = useAccountMode();
  const [tab, setTab] = useState("bookings");
  const { data: accounts = [] } = useQuery({
    queryKey: ["admin-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name, email, is_host, is_admin, created_at").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: allowedModes.includes("admin"),
  });

  if (!capabilities || !allowedModes.includes("admin")) return <Navigate to="/dashboard" replace />;

  return <AccountModeGuard mode="admin"><MainLayout>
    <div className="container min-h-screen px-4 pb-16 pt-28">
      <div className="mb-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">Platform administration</p>
        <h1 className="mt-2 font-display text-3xl tracking-wide md:text-4xl">ZONYX ADMIN</h1>
        <p className="mt-2 text-sm text-muted-foreground">Bookings, listings, accounts, and platform promotions.</p>
      </div>
      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="bookings"><ClipboardList className="mr-2 h-4 w-4" /><span className="hidden sm:inline">Bookings</span></TabsTrigger>
          <TabsTrigger value="vehicles"><Car className="mr-2 h-4 w-4" /><span className="hidden sm:inline">Vehicles</span></TabsTrigger>
          <TabsTrigger value="accounts"><Users className="mr-2 h-4 w-4" /><span className="hidden sm:inline">Accounts</span></TabsTrigger>
          <TabsTrigger value="promos"><Tag className="mr-2 h-4 w-4" /><span className="hidden sm:inline">Promo Codes</span></TabsTrigger>
        </TabsList>
        <TabsContent value="bookings"><HostBookingsTab hostId={capabilities.profile_id} isAdmin /></TabsContent>
        <TabsContent value="vehicles"><HostVehiclesTab hostId={capabilities.profile_id} isAdmin /></TabsContent>
        <TabsContent value="accounts">
          <div className="grid gap-3">
            {accounts.map((account) => <Card key={account.id}><CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="font-semibold">{account.full_name || "Profile incomplete"}</p><p className="text-sm text-muted-foreground">{account.email}</p></div>
              <div className="flex gap-2 text-xs uppercase tracking-wide"><span>Guest</span>{account.is_host && <span className="text-primary">Host</span>}{account.is_admin && <span className="text-primary">Admin</span>}</div>
            </CardContent></Card>)}
          </div>
        </TabsContent>
        <TabsContent value="promos"><PromoCodesTab /></TabsContent>
      </Tabs>
    </div>
  </MainLayout></AccountModeGuard>;
}