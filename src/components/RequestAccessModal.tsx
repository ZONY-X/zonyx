import { useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle } from "lucide-react";

const requestAccessSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: "Name is required" })
    .max(100, { message: "Name must be less than 100 characters" }),
  email: z
    .string()
    .trim()
    .email({ message: "Please enter a valid email address" })
    .max(255, { message: "Email must be less than 255 characters" }),
});

type RequestAccessFormData = z.infer<typeof requestAccessSchema>;

interface RequestAccessModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RequestAccessModal({ open, onOpenChange }: RequestAccessModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RequestAccessFormData>({
    resolver: zodResolver(requestAccessSchema),
  });

  const onSubmit = async (data: RequestAccessFormData) => {
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('access_requests')
        .insert({ 
          name: data.name.trim(), 
          email: data.email.trim().toLowerCase() 
        });
      
      if (error) throw error;
      setIsSubmitted(true);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Submission failed",
        description: "Please try again later.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    // Reset form state after modal closes
    setTimeout(() => {
      setIsSubmitted(false);
      reset();
    }, 300);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        {isSubmitted ? (
          // Success State
          <div className="text-center py-6">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-8 h-8 text-primary" />
            </div>
            <DialogHeader className="space-y-3">
              <DialogTitle className="text-2xl font-bold text-center">
                You're on the list.
              </DialogTitle>
              <DialogDescription className="text-center text-base leading-relaxed">
                Thanks for requesting access to ZONYX.
                <br /><br />
                We're currently onboarding a limited group of Early Hosts & Drivers to ensure quality, alignment, and a seamless experience for everyone.
                <br /><br />
                Our team will review your request and get back to you shortly.
              </DialogDescription>
            </DialogHeader>
            <p className="text-xs text-muted-foreground mt-6 italic">
              Built with intention.
            </p>
            <Button className="mt-6" onClick={handleClose}>
              Close
            </Button>
          </div>
        ) : (
          // Form State
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-bold">Request Access</DialogTitle>
              <DialogDescription>
                Submit your details and we'll review your request to join the ZONYX vehicle network.
              </DialogDescription>
            </DialogHeader>
            
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  placeholder="Enter your full name"
                  {...register("name")}
                  aria-invalid={!!errors.name}
                />
                {errors.name && (
                  <p className="text-sm text-destructive">{errors.name.message}</p>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  {...register("email")}
                  aria-invalid={!!errors.email}
                />
                {errors.email && (
                  <p className="text-sm text-destructive">{errors.email.message}</p>
                )}
              </div>
              
              <div className="flex justify-end gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClose}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Submitting..." : "Submit Request"}
                </Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
