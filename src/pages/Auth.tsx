import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { z } from "zod";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { MainLayout } from "@/components/layout/MainLayout";

const authSchema = z.object({
  email: z.string().trim().email({ message: "Invalid email address" }).max(255),
  password: z.string().min(6, { message: "Password must be at least 6 characters" }).max(100),
});

const emailSchema = z.object({
  email: z.string().trim().email({ message: "Invalid email address" }).max(255),
});

export default function Auth() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const { signIn, signUp, resetPassword, user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const redirectParam = searchParams.get("redirectTo");
  const resetSuccess = searchParams.get("reset") === "success";
  const queryParams = new URLSearchParams(window.location.search);
  const hashValue = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams = new URLSearchParams(hashValue);
  const hasRecoveryContext =
    queryParams.get("type") === "recovery" ||
    hashParams.get("type") === "recovery" ||
    queryParams.has("error_code") ||
    hashParams.has("error_code") ||
    queryParams.has("error_description") ||
    hashParams.has("error_description") ||
    hashParams.has("access_token") ||
    hashParams.has("refresh_token") ||
    queryParams.has("access_token") ||
    queryParams.has("refresh_token");
  const safeRedirectTo =
    redirectParam &&
    redirectParam.startsWith("/") &&
    !redirectParam.startsWith("//") &&
    !redirectParam.includes("://")
      ? redirectParam
      : null;
  const postAuthRedirect = safeRedirectTo ?? "/dashboard";

  // Determine initial tab based on URL param
  const initialMode = searchParams.get("mode") === "signup" ? "signup" : "signin";
  const [activeTab, setActiveTab] = useState(initialMode);

  // Redirect if already logged in
  useEffect(() => {
    if (hasRecoveryContext) {
      navigate(
        {
          pathname: "/reset-password",
          search: window.location.search,
          hash: window.location.hash,
        },
        { replace: true }
      );
      return;
    }

    if (user) {
      navigate(postAuthRedirect, { replace: true });
    }
  }, [hasRecoveryContext, user, navigate, postAuthRedirect]);

  useEffect(() => {
    if (resetSuccess) {
      toast({
        title: "Password reset complete",
        description: "Sign in with your new password.",
      });
      navigate("/auth", { replace: true });
    }
  }, [resetSuccess, navigate, toast]);

  const validateForm = () => {
    const result = authSchema.safeParse({ email, password });
    if (!result.success) {
      const fieldErrors: { email?: string; password?: string } = {};
      result.error.errors.forEach((err) => {
        if (err.path[0] === "email") fieldErrors.email = err.message;
        if (err.path[0] === "password") fieldErrors.password = err.message;
      });
      setErrors(fieldErrors);
      return false;
    }
    setErrors({});
    return true;
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    
    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);

    if (error) {
      toast({
        variant: "destructive",
        title: "Sign in failed",
        description: "Invalid email or password. Please try again.",
      });
    } else {
      toast({
        title: "Welcome back!",
        description: "You have successfully signed in.",
      });
      navigate(postAuthRedirect, { replace: true });
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = emailSchema.safeParse({ email });
    if (!result.success) {
      setErrors({ email: result.error.errors[0].message });
      return;
    }
    setErrors({});
    
    setLoading(true);
    const { error } = await resetPassword(email);
    setLoading(false);

    if (error) {
      toast({
        variant: "destructive",
        title: "Request failed",
        description: error.message || "Could not send reset email. Please try again.",
      });
    } else {
      toast({
        title: "Check your email",
        description: "We've sent you a password reset link.",
      });
      setShowForgotPassword(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    
    setLoading(true);
    const { error } = await signUp(email, password);
    setLoading(false);

    if (error) {
      toast({
        variant: "destructive",
        title: "Sign up failed",
        description: "Could not create account. Please try again.",
      });
    } else {
      toast({
        title: "Account created!",
        description: "Welcome to ZONYX!",
      });
      navigate(postAuthRedirect, { replace: true });
    }
  };

  if (showForgotPassword) {
    return (
      <MainLayout>
        <div className="min-h-[80vh] flex items-center justify-center px-4">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">Forgot Password</CardTitle>
              <CardDescription>Enter your email and we'll send you a reset link</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reset-email">Email</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                  />
                  {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Sending..." : "Send Reset Link"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => setShowForgotPassword(false)}
                >
                  Back to Sign In
                </Button>
              </form>
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
            <CardTitle className="text-2xl">WELCOME</CardTitle>
            <CardDescription>Sign in or create an account to continue</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2 bg-muted">
                <TabsTrigger 
                  value="signin" 
                  className="data-[state=inactive]:text-primary data-[state=inactive]:bg-background data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  SIGN IN
                </TabsTrigger>
                <TabsTrigger 
                  value="signup" 
                  className="data-[state=inactive]:text-primary data-[state=inactive]:bg-background data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  SIGN UP
                </TabsTrigger>
              </TabsList>
              <TabsContent value="signin">
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signin-email">Email</Label>
                    <Input
                      id="signin-email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={loading}
                    />
                    {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="signin-password">Password</Label>
                      <button
                        type="button"
                        onClick={() => setShowForgotPassword(true)}
                        className="text-sm text-primary hover:underline"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <Input
                      id="signin-password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={loading}
                    />
                    {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Signing in..." : "Sign In"}
                  </Button>
                </form>
              </TabsContent>
              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={loading}
                    />
                    {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={loading}
                    />
                    {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Creating account..." : "Sign Up"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
