import { MainLayout } from "@/components/layout/MainLayout";
import { RentalImageUpload } from "@/components/rental/RentalImageUpload";
import { AIAssistant } from "@/components/chat/AIAssistant";
import { useAuth } from "@/hooks/useAuth";
import { useGuest } from "@/hooks/useGuest";
import { useHost } from "@/hooks/useHost";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Car, Calendar, Upload, User } from "lucide-react";
import { Link } from "react-router-dom";
export default function Dashboard() {
  const {
    user
  } = useAuth();
  const {
    isGuest
  } = useGuest();
  const {
    isHost,
    isApproved
  } = useHost();
  const {
    t
  } = useLanguage();

  // Determine user role for image uploads - prefer host if approved, otherwise guest
  const userRole = isHost && isApproved ? "host" : "guest";
  const quickActions = [{
    icon: Car,
    title: "BROWSE FLEET",
    description: "Find Your  Ride",
    href: "/fleet"
  }, {
    icon: Calendar,
    title: "MY BOOKINGS",
    description: "View Your Reservations",
    href: isGuest ? "/guest-dashboard?tab=bookings" : "/bookings"
  }, {
    icon: User,
    title: "PROFILE",
    description: "Manage Your Account",
    href: isGuest ? "/guest-dashboard?tab=profile" : "/profile"
  }];
  return <MainLayout>
      <div className="container py-24 min-h-screen">
        {/* Welcome Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl md:text-4xl font-bold mb-2 text-secondary-foreground">
            WELCOME BACK!
          </h1>
          <p className="text-primary">
            {user?.email}
          </p>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {quickActions.map(action => <Card key={action.title} className="hover:border-primary/50 transition-colors">
              <CardHeader className="flex flex-col items-center">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <action.icon className="w-8 h-8 text-primary" />
                </div>
                <CardTitle className={`text-lg ${action.title === "PROFILE" ? "text-green-500" : ""}`}>{action.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <Button variant="outline" asChild className={`w-full ${action.title === "PROFILE" || action.title === "BROWSE FLEET" || action.title === "MY BOOKINGS" ? "bg-green-500 text-black hover:bg-green-600 border-green-500" : ""}`}>
                  <Link to={action.href}>
                    {action.title}
                  </Link>
                </Button>
                <CardDescription className="mt-3 text-center">{action.description}</CardDescription>
              </CardContent>
            </Card>)}
        </div>

        {/* Rental Image Upload Section */}
        <div className="mb-12">
          <Card>
            <CardHeader>
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Upload className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-primary">{t("rental.title")}</CardTitle>
                  <CardDescription className="text-foreground">{t("rental.description")}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {(isGuest || isHost && isApproved) && <RentalImageUpload userRole={userRole} />}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* AI Assistant */}
      <AIAssistant />
    </MainLayout>;
}