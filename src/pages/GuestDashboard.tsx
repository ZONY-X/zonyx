import { useState, useEffect } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useGuest } from "@/hooks/useGuest";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Car, CalendarDays, MessageSquare, User, Camera } from "lucide-react";
import { GuestBookingsTab } from "@/components/guest/GuestBookingsTab";
import { GuestHistoryTab } from "@/components/guest/GuestHistoryTab";
import { GuestMessagesTab } from "@/components/guest/GuestMessagesTab";
import { GuestProfileTab } from "@/components/guest/GuestProfileTab";
import { RentalImageUpload } from "@/components/rental/RentalImageUpload";
export default function GuestDashboard() {
  const {
    user,
    loading: authLoading
  } = useAuth();
  const {
    guest,
    isGuest,
    guestLoading
  } = useGuest();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "bookings");

  // Sync URL params with active tab
  useEffect(() => {
    const tabFromUrl = searchParams.get("tab");
    if (tabFromUrl && tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [searchParams]);
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setSearchParams({
      tab
    });
  };
  if (authLoading || guestLoading) {
    return <MainLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>;
  }
  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // If not a registered guest, show registration prompt
  if (!isGuest) {
    return <MainLayout>
        <div className="container mx-auto px-4 py-12">
          <Card className="max-w-lg mx-auto">
            <CardHeader>
              <CardTitle>Complete Your Guest Profile</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">
                To start booking vehicles, please complete your guest profile.
              </p>
              <GuestProfileTab userId={user.id} isNewGuest={true} />
            </CardContent>
          </Card>
        </div>
      </MainLayout>;
  }
  return <MainLayout>
      <div className="container mx-auto px-4 pt-24 pb-8">
        {/* Welcome Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-primary uppercase">
            Welcome back {guest.display_name}!
          </h1>
          <p className="text-muted-foreground mt-2 uppercase">
            MANAGE YOUR TRIP
          </p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => handleTabChange("bookings")}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-primary/10 rounded-full">
                  <Car className="h-6 w-6 text-primary" />
                </div>
                <div>
                  
                  <p className="font-bold bg-secondary text-primary text-lg">​ACTIVE BOOKING </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => handleTabChange("history")}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-primary/10 rounded-full">
                  <CalendarDays className="h-6 w-6 text-primary" />
                </div>
                <div>
                  
                  <p className="font-bold text-primary text-xl">​TRIP HISTORY </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => handleTabChange("messages")}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-primary/10 rounded-full">
                  <MessageSquare className="h-6 w-6 text-primary" />
                </div>
                <div>
                  
                  <p className="font-bold text-primary text-xl">​MESSEGES </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="grid w-full grid-cols-5 mb-6">
            <TabsTrigger value="bookings" className="flex items-center gap-2">
              <Car className="h-4 w-4" />
              <span className="hidden sm:inline">Bookings</span>
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              <span className="hidden sm:inline">History</span>
            </TabsTrigger>
            <TabsTrigger value="photos" className="flex items-center gap-2">
              <Camera className="h-4 w-4" />
              <span className="hidden sm:inline">Photos</span>
            </TabsTrigger>
            <TabsTrigger value="messages" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              <span className="hidden sm:inline">Messages</span>
            </TabsTrigger>
            <TabsTrigger value="profile" className="flex items-center gap-2">
              <User className="h-4 w-4" />
              <span className="hidden sm:inline">Profile</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="bookings">
            <GuestBookingsTab guestId={guest.id} />
          </TabsContent>

          <TabsContent value="history">
            <GuestHistoryTab guestId={guest.id} />
          </TabsContent>

          <TabsContent value="photos">
            <RentalImageUpload userRole="guest" />
          </TabsContent>

          <TabsContent value="messages">
            <GuestMessagesTab guestId={guest.id} />
          </TabsContent>

          <TabsContent value="profile">
            <GuestProfileTab userId={user.id} guest={guest} />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>;
}