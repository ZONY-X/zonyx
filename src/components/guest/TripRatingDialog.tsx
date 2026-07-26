import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Star } from "lucide-react";
import { toast } from "sonner";

interface TripRatingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: string;
  vehicleName: string;
  existingRating?: {
    id: string;
    rating: number;
    review: string | null;
  };
}

export function TripRatingDialog({
  open,
  onOpenChange,
  bookingId,
  vehicleName,
  existingRating,
}: TripRatingDialogProps) {
  const [rating, setRating] = useState(existingRating?.rating || 0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [review, setReview] = useState(existingRating?.review || "");
  const queryClient = useQueryClient();

  const submitRating = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      if (existingRating) {
        const { error } = await supabase
          .from("ratings")
          .update({ rating, review: review || null })
          .eq("id", existingRating.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("ratings").insert({
          booking_id: bookingId,
          rater_id: user.id,
          rating,
          review: review || null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(existingRating ? "Rating updated!" : "Thanks for your rating!");
      queryClient.invalidateQueries({ queryKey: ["guest-history"] });
      queryClient.invalidateQueries({ queryKey: ["booking-rating", bookingId] });
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error("Failed to submit rating: " + error.message);
    },
  });

  const displayRating = hoveredRating || rating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {existingRating ? "Edit Your Rating" : "Rate This Trip"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            How was your experience with <span className="font-medium text-foreground">{vehicleName}</span>?
          </p>

          {/* Star Rating */}
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setRating(star)}
                onMouseEnter={() => setHoveredRating(star)}
                onMouseLeave={() => setHoveredRating(0)}
                className="p-1 transition-transform hover:scale-110 focus:outline-none"
              >
                <Star
                  className={`h-8 w-8 transition-colors ${
                    star <= displayRating
                      ? "fill-yellow-400 text-yellow-400"
                      : "text-muted-foreground"
                  }`}
                />
              </button>
            ))}
          </div>

          <p className="text-center text-sm text-muted-foreground">
            {displayRating === 0 && "Click to rate"}
            {displayRating === 1 && "Poor"}
            {displayRating === 2 && "Fair"}
            {displayRating === 3 && "Good"}
            {displayRating === 4 && "Very Good"}
            {displayRating === 5 && "Excellent"}
          </p>

          {/* Review Text */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Write a review (optional)
            </label>
            <Textarea
              placeholder="Share your experience..."
              value={review}
              onChange={(e) => setReview(e.target.value)}
              rows={4}
              maxLength={1000}
            />
            <p className="text-xs text-muted-foreground text-right">
              {review.length}/1000
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => submitRating.mutate()}
            disabled={rating === 0 || submitRating.isPending}
          >
            {submitRating.isPending ? "Submitting..." : existingRating ? "Update Rating" : "Submit Rating"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
