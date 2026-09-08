import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { useHost } from "@/hooks/useHost";
import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Camera, Car, Clock, History } from "lucide-react";
import { HostVehiclesTab } from "@/components/host/HostVehiclesTab";
import { HostBookingsTab } from "@/components/host/HostBookingsTab";
import { HostHistoryTab } from "@/components/host/HostHistoryTab";
import { HostPendingApproval } from "@/components/host/HostPendingApproval";
import { AccountModeGuard } from "@/components/account/AccountModeGuard";
import { RentalImageUpload } from "@/components/rental/RentalImageUpload";
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
  const [activeTab, setActiveTab] = useState("bookings");
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
  return <AccountModeGuard mode="host"><MainLayout>
      <div className="container py-24 min-h-screen relative">
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
          <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-flex">
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
            <TabsTrigger value="photos" className="gap-2">
              <Camera className="w-4 h-4" />
              <span className="hidden sm:inline">Trip Photos</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="bookings">
            <HostBookingsTab hostId={host.id} isAdmin={false} />
          </TabsContent>

          <TabsContent value="history">
            <HostHistoryTab hostId={host.id} />
          </TabsContent>

          <TabsContent value="vehicles">
            <HostVehiclesTab hostId={host.id} />
          </TabsContent>
          <TabsContent value="photos">
            <RentalImageUpload userRole="host" profileId={host.id} />
          </TabsContent>

        </Tabs>
      </div>
    </MainLayout></AccountModeGuard>;
}