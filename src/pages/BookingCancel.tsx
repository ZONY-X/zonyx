import { Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { XCircle } from "lucide-react";

export default function BookingCancel() {
  return (
    <MainLayout>
      <section className="pt-24 pb-20">
        <div className="container max-w-3xl">
          <div className="rounded-3xl border border-border bg-card/80 p-8 text-center shadow-sm md:p-10">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <XCircle className="h-8 w-8" />
            </div>
            <h1 className="mt-6 text-3xl font-semibold text-foreground">Payment was canceled</h1>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              Your booking was not completed. You can try again at any time and we will keep your selected vehicle available during checkout.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild>
                <Link to="/fleet">Return to vehicles</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/contact">Contact support</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </MainLayout>
  );
}
