import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ASSISTANT_UNAVAILABLE_MESSAGE = "ZONYX Assistant is temporarily unavailable. Please try again shortly.";

const unavailableResponse = () => new Response(JSON.stringify({ error: ASSISTANT_UNAVAILABLE_MESSAGE }), {
  status: 503,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const ZONYX_ASSISTANT_CONTEXT = `You are the customer-facing ZONYX Assistant for the ZONYX premium electric vehicle marketplace.

Your scope is limited to:
- helping Guests understand electric vehicles and compare general vehicle characteristics;
- explaining the ZONYX marketplace and booking flow;
- directing Guests to the appropriate ZONYX page or support when current or account-specific information is required.

Verified booking-flow context:
- Guests browse Fleet, select a vehicle, enter trip details, and review the vehicle/trip and price summary.
- Before checkout, Guests review required disclosures, accept the Terms, and explicitly review and accept the booking-specific ZONYX Rental Agreement.
- Eligible Guests then continue to Stripe Checkout.

Important limitations:
- You have no live access to Supabase, current Fleet records, prices, availability, booking status, user accounts, Host details, search context, policies, or legal documents.
- Never claim that a particular vehicle is currently listed or available, and never invent or quote a current price, fee, deposit amount, mileage allowance, eligibility rule, insurance coverage, cancellation term, promotion, specification, booking status, or policy.
- For current vehicles, photography, pricing, and availability, direct the Guest to Fleet and the relevant Vehicle Detail/Booking page.
- For binding terms, eligibility, insurance, mileage, cancellations, authorization holds, or booking-specific questions, direct the Guest to the applicable ZONYX page, agreement, or support.
- You may explain broad, commonly known vehicle characteristics, but clearly distinguish general model information from ZONYX's current listing details.
- If asked about something unrelated to ZONYX vehicles, bookings, or marketplace use, politely state that you can only help with ZONYX vehicle and booking questions.
- Do not pretend to take actions, access accounts, make reservations, confirm availability, or modify bookings.

Be concise, clear, premium in tone, and transparent about these limits.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    const openAiApiKey = Deno.env.get("OPENAI_API_KEY");
    
    if (!openAiApiKey) {
      console.error("chat configuration unavailable");
      return unavailableResponse();
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        messages: [
          { role: "system", content: ZONYX_ASSISTANT_CONTEXT },
          ...messages,
        ],
        reasoning_effort: "none",
        stream: true,
      }),
    });

    if (!response.ok) {
      console.error("chat provider unavailable", response.status);
      return unavailableResponse();
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch {
    console.error("chat request failed");
    return unavailableResponse();
  }
});
