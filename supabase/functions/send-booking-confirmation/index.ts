import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RequestPayload {
  bookingId?: string;
}

function formatUsdFromCents(cents: number | null | undefined): string {
  const safeCents = Number(cents || 0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(safeCents / 100);
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "N/A";
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(parsed);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authorizationHeader = req.headers.get("authorization");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("BOOKING_CONFIRMATION_FROM_EMAIL");
    const replyTo = Deno.env.get("BOOKING_CONFIRMATION_REPLY_TO") || undefined;
    const appPublicUrl = Deno.env.get("APP_PUBLIC_URL") || "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!resendApiKey || !fromEmail || !supabaseUrl || !supabaseServiceRoleKey) {
      return new Response(JSON.stringify({ error: "Email function environment is incomplete." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!authorizationHeader) {
      return new Response(JSON.stringify({ error: "Authorization header is required." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authParts = authorizationHeader.split(" ");
    if (authParts.length !== 2 || authParts[0] !== "Bearer" || !authParts[1]) {
      return new Response(JSON.stringify({ error: "Invalid authorization format." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const providedToken = authParts[1];
    if (providedToken !== supabaseServiceRoleKey) {
      return new Response(JSON.stringify({ error: "Forbidden." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as RequestPayload;
    const bookingId = body?.bookingId?.trim();

    if (!bookingId) {
      return new Response(JSON.stringify({ error: "bookingId is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, reservation_number, vehicle_id, renter_profile_id, start_date, end_date, grand_total_cents, authorization_hold_amount_cents, confirmation_email_sent_at")
      .eq("id", bookingId)
      .maybeSingle<{
        id: string;
        reservation_number: string;
        vehicle_id: string;
        renter_profile_id: string;
        start_date: string;
        end_date: string;
        grand_total_cents: number;
        authorization_hold_amount_cents: number | null;
        confirmation_email_sent_at: string | null;
      }>();

    if (bookingError) {
      console.error("send-booking-confirmation: booking lookup failed", bookingError);
      return new Response(JSON.stringify({ error: "Unable to load booking." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!booking) {
      return new Response(JSON.stringify({ error: "Booking not found." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (booking.confirmation_email_sent_at) {
      return new Response(JSON.stringify({ sent: false, skipped: true, reason: "already_sent" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: renterProfile, error: profileError } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", booking.renter_profile_id)
      .maybeSingle<{ email: string | null }>();

    if (profileError) {
      console.error("send-booking-confirmation: profile lookup failed", profileError);
      return new Response(JSON.stringify({ error: "Unable to load booking recipient." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const recipientEmail = (renterProfile?.email || "").trim();
    if (!recipientEmail) {
      return new Response(JSON.stringify({ error: "Recipient email is missing." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: vehicle, error: vehicleError } = await supabase
      .from("vehicles")
      .select("brand, model, name")
      .eq("id", booking.vehicle_id)
      .maybeSingle<{ brand: string | null; model: string | null; name: string | null }>();

    if (vehicleError) {
      console.error("send-booking-confirmation: vehicle lookup failed", vehicleError);
      return new Response(JSON.stringify({ error: "Unable to load booking vehicle." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const vehicleLabel = [vehicle?.brand, vehicle?.model || vehicle?.name].filter(Boolean).join(" ").trim() || "Vehicle";
    const totalPaid = formatUsdFromCents(booking.grand_total_cents);
    const holdAmount = booking.authorization_hold_amount_cents != null
      ? formatUsdFromCents(booking.authorization_hold_amount_cents)
      : "N/A";
    const reservationNumber = booking.reservation_number || booking.id;
    const bookingLink = appPublicUrl ? `${appPublicUrl.replace(/\/$/, "")}/dashboard` : "";

    const subject = `Booking confirmed: ${reservationNumber}`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.5; color: #111827;">
        <h2 style="margin: 0 0 12px;">Your booking is confirmed</h2>
        <p style="margin: 0 0 16px;">Thanks for your booking. Here is your summary:</p>
        <table style="border-collapse: collapse; width: 100%; max-width: 560px;">
          <tr><td style="padding: 6px 0; color: #6b7280;">Reservation</td><td style="padding: 6px 0; font-weight: 600;">${reservationNumber}</td></tr>
          <tr><td style="padding: 6px 0; color: #6b7280;">Vehicle</td><td style="padding: 6px 0; font-weight: 600;">${vehicleLabel}</td></tr>
          <tr><td style="padding: 6px 0; color: #6b7280;">Rental dates</td><td style="padding: 6px 0; font-weight: 600;">${formatDate(booking.start_date)} - ${formatDate(booking.end_date)}</td></tr>
          <tr><td style="padding: 6px 0; color: #6b7280;">Total paid</td><td style="padding: 6px 0; font-weight: 600;">${totalPaid}</td></tr>
          <tr><td style="padding: 6px 0; color: #6b7280;">Security deposit authorization hold</td><td style="padding: 6px 0; font-weight: 600;">${holdAmount}</td></tr>
        </table>
        ${bookingLink ? `<p style="margin: 16px 0 0;"><a href="${bookingLink}">View your bookings</a></p>` : ""}
      </div>
    `;

    const text = [
      "Your booking is confirmed.",
      `Reservation: ${reservationNumber}`,
      `Vehicle: ${vehicleLabel}`,
      `Rental dates: ${formatDate(booking.start_date)} - ${formatDate(booking.end_date)}`,
      `Total paid: ${totalPaid}`,
      `Security deposit authorization hold: ${holdAmount}`,
      bookingLink ? `View your bookings: ${bookingLink}` : "",
    ].filter(Boolean).join("\n");

    const resendPayload: Record<string, unknown> = {
      from: fromEmail,
      to: [recipientEmail],
      subject,
      html,
      text,
    };

    if (replyTo) {
      resendPayload.reply_to = replyTo;
    }

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `booking-confirmation/${booking.id}/v1`,
      },
      body: JSON.stringify(resendPayload),
    });

    const resendBodyText = await resendResponse.text();
    let resendData: { id?: string; error?: { message?: string } } = {};
    if (resendBodyText) {
      try {
        resendData = JSON.parse(resendBodyText);
      } catch {
        resendData = {};
      }
    }

    if (!resendResponse.ok || !resendData.id) {
      console.error("send-booking-confirmation: resend failed", {
        bookingId: booking.id,
        status: resendResponse.status,
        body: resendBodyText,
      });
      return new Response(JSON.stringify({ error: "Confirmation email send failed." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const nowIso = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        confirmation_email_sent_at: nowIso,
        confirmation_email_provider_id: resendData.id,
        updated_at: nowIso,
      })
      .eq("id", booking.id)
      .is("confirmation_email_sent_at", null);

    if (updateError) {
      console.error("send-booking-confirmation: booking update failed", updateError);
      return new Response(JSON.stringify({ error: "Confirmation email was sent but booking marker update failed." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ sent: true, bookingId: booking.id, providerId: resendData.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("send-booking-confirmation: unhandled error", error);
    return new Response(JSON.stringify({ error: "Unable to send confirmation email." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
