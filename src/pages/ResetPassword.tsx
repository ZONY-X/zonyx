import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { MainLayout } from "@/components/layout/MainLayout";

const passwordSchema = z.object({
  password: z.string().min(6, { message: "Password must be at least 6 characters" }).max(100),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [linkChecked, setLinkChecked] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirmPassword?: string }>({});
  const { updatePassword, session } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    let mounted = true;
    const hashHasRecoveryType = window.location.hash.includes("type=recovery");
    const queryHasRecoveryType = new URLSearchParams(window.location.search).get("type") === "recovery";
    const hasRecoveryHint = hashHasRecoveryType || queryHasRecoveryType;

    const { data: authListener } = supabase.auth.onAuthStateChange((event, authSession) => {
      if (!mounted) return;
      if (event === "PASSWORD_RECOVERY" && authSession) {
        setRecoveryReady(true);
        setLinkInvalid(false);
        setLinkChecked(true);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session && (hasRecoveryHint || session)) {
        setRecoveryReady(true);
        setLinkInvalid(false);
      } else if (!data.session && !hasRecoveryHint) {
        setLinkInvalid(true);
      }
      setLinkChecked(true);
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [session]);

  useEffect(() => {
    if (linkInvalid) {
      toast({
        variant: "destructive",
        title: "Invalid or expired link",
        description: "Please request a new password reset link.",
      });
    }
  }, [linkInvalid, toast]);

  const validateForm = () => {
    const result = passwordSchema.safeParse({ password, confirmPassword });
    if (!result.success) {
      const fieldErrors: { password?: string; confirmPassword?: string } = {};
      result.error.errors.forEach((err) => {
        if (err.path[0] === "password") fieldErrors.password = err.message;
        if (err.path[0] === "confirmPassword") fieldErrors.confirmPassword = err.message;
      });
      setErrors(fieldErrors);
      return false;
    }
    setErrors({});
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setLoading(true);
    const { error } = await updatePassword(password);
    setLoading(false);

    if (error) {
      toast({
        variant: "destructive",
        title: "Password update failed",
        description: error.message || "Could not update password. Please try again.",
      });
    } else {
      toast({
        title: "Password updated!",
        description: "You can now sign in with your new password.",
      });
      navigate("/auth?reset=success", { replace: true });
    }
  };

  if (!linkChecked) {
    return (
      <MainLayout>
        <div className="min-h-[80vh] flex items-center justify-center px-4">
          <Card className="w-full max-w-md">
            <CardContent className="py-10 text-center text-muted-foreground">Validating recovery link...</CardContent>
          </Card>
        </div>
      </MainLayout>
    );
  }

  if (linkInvalid || !recoveryReady) {
    return (
      <MainLayout>
        <div className="min-h-[80vh] flex items-center justify-center px-4">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">Reset link unavailable</CardTitle>
              <CardDescription>This password reset link is invalid or has expired.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" onClick={() => navigate("/auth", { replace: true })}>
                Request another reset email
              </Button>
            </CardContent>
          </Card>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="min-h-[80vh] flex items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Reset Password</CardTitle>
            <CardDescription>Enter your new password below</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">New Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                />
                {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                />
                {errors.confirmPassword && <p className="text-sm text-destructive">{errors.confirmPassword}</p>}
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Updating..." : "Update Password"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
