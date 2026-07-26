import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock } from "lucide-react";
import type { Host } from "@/hooks/useHost";

interface HostPendingApprovalProps {
  host: Host;
}

export function HostPendingApproval({ host }: HostPendingApprovalProps) {
  return (
    <div className="container py-24 min-h-screen flex items-center justify-center">
      <Card className="max-w-md w-full text-center">
        <CardHeader>
          <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
            <Clock className="w-8 h-8 text-amber-500" />
          </div>
          <CardTitle className="text-2xl">Pending Approval</CardTitle>
          <CardDescription>
            Your host application is being reviewed
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            Thank you for applying to become a host, <strong>{host.host_name}</strong>! 
            Our team is reviewing your application and will get back to you within 24-48 hours.
          </p>
          <p className="text-sm text-muted-foreground">
            You'll receive an email at <strong>{host.email}</strong> once your application is approved.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
