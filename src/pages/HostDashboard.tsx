import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { useHost } from "@/hooks/useHost";
import { useGuest } from "@/hooks/useGuest";
import { useAuth } from "@/hooks/useAuth";
import { Navigate, useNavigate } from "react-router-dom";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { User } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Car, Clock, History, Tag } from "lucide-react";
import { HostVehiclesTab } from "@/components/host/HostVehiclesTab";
import { HostBookingsTab } from "@/components/host/HostBookingsTab";
import { HostHistoryTab } from "@/components/host/HostHistoryTab";
import { PromoCodesTab } from "@/components/host/PromoCodesTab";
import { HostPendingApproval } from "@/components/host/HostPendingApproval";
export default function HostDashboard() {
  const {
    user,
    loading: authLoading
  } = useAuth();
  const {
    host,
    isApproved,
    isLoading: hostLoading
  } = useHost();
  const {
    isGuest
  } = useGuest();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("bookings");
  const handleModeSwitch = (checked: boolean) => {
    if (checked) {
      navigate("/guest-dashboard");
    }
  };
  if (authLoading || hostLoading) {
    return <MainLayout>
        <div className="container py-24 min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
        </div>
      </MainLayout>;
  }
  if (!user) {
    return <Navigate to="/auth" replace />;
  }
  if (!host) {
    return <Navigate to="/become-host" replace />;
  }
  if (!isApproved) {
    return <MainLayout>
        <HostPendingApproval host={host} />
      </MainLayout>;
  }
  return <MainLayout>
      <div className="container py-24 min-h-screen relative">
        {/* Mode Toggle - Upper right corner */}
        {isApproved && isGuest && <div className="absolute top-24 right-4 md:right-8">
            <div className="flex items-center gap-2 p-2 rounded-lg bg-card border border-border">
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="w-3 h-3 text-primary" />
              </div>
              <Label htmlFor="mode-switch" className="text-xs font-medium cursor-pointer">
                Guest Mode
              </Label>
              <Switch id="mode-switch" checked={false} onCheckedChange={handleModeSwitch} />
            </div>
          </div>}

        {/* Welcome Header */}
        <div className="mb-8 text-center">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-2 uppercase">
              WELCOME {host.full_name}!
            </h1>
            <p className="text-primary font-sans text-sm">
              Manage Vehicle Bookings and Business
            </p>
          </div>
        </div>

        {/* Quick Stats Thumbnails */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card className={`cursor-pointer transition-all hover:border-primary/50 ${activeTab === 'bookings' ? 'border-primary bg-primary/5' : ''}`} onClick={() => setActiveTab('bookings')}>
            <CardHeader className="flex flex-row items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Clock className="w-6 h-6 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">BOOKED Trips</CardTitle>
                <CardDescription>Active Reservations</CardDescription>
              </div>
            </CardHeader>
          </Card>

          <Card className={`cursor-pointer transition-all hover:border-primary/50 ${activeTab === 'history' ? 'border-primary bg-primary/5' : ''}`} onClick={() => setActiveTab('history')}>
            <CardHeader className="flex flex-row items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-green-500/10 flex items-center justify-center">
                <History className="w-6 h-6 text-green-500" />
              </div>
              <div>
                <CardTitle className="text-lg">HISTORY</CardTitle>
                <CardDescription>Past Trips & Earnings</CardDescription>
              </div>
            </CardHeader>
          </Card>

          <Card className={`cursor-pointer transition-all hover:border-primary/50 ${activeTab === 'vehicles' ? 'border-primary bg-primary/5' : ''}`} onClick={() => setActiveTab('vehicles')}>
            <CardHeader className="flex flex-row items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Car className="w-6 h-6 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">VEHICLES</CardTitle>
                <CardDescription>Manage Fleet</CardDescription>
              </div>
            </CardHeader>
          </Card>
        </div>

        {/* Main Content Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className={host.is_admin ? "grid w-full grid-cols-4 lg:w-auto lg:inline-flex" : "grid w-full grid-cols-3 lg:w-auto lg:inline-flex"}>
            <TabsTrigger value="bookings" className="gap-2">
              <Clock className="w-4 h-4" />
              <span className="hidden sm:inline">Bookings</span>
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <History className="w-4 h-4" />
              <span className="hidden sm:inline">History</span>
            </TabsTrigger>
            <TabsTrigger value="vehicles" className="gap-2">
              <Car className="w-4 h-4" />
              <span className="hidden sm:inline">Vehicles</span>
            </TabsTrigger>
            {host.is_admin && (
              <TabsTrigger value="promo-codes" className="gap-2">
                <Tag className="w-4 h-4" />
                <span className="hidden sm:inline">Promo Codes</span>
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="bookings">
            <HostBookingsTab hostId={host.id} isAdmin={host.is_admin} />
          </TabsContent>

          <TabsContent value="history">
            <HostHistoryTab hostId={host.id} />
          </TabsContent>

          <TabsContent value="vehicles">
            <HostVehiclesTab hostId={host.id} />
          </TabsContent>

          {host.is_admin && (
            <TabsContent value="promo-codes">
              <PromoCodesTab />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </MainLayout>;
}