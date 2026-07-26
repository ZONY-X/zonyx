import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VEHICLE_CONTEXT = `You are an AI assistant for ZONYX, a premium electric vehicle rental service. You help customers with:

1. VEHICLE COMPARISONS - Help users choose between vehicles:
   - Tesla Model 3 ($89/day): 5 seats, electric, great for city driving and efficiency
   - Tesla Cybertruck ($149/day): 5 seats, electric truck, perfect for adventures and hauling
   - Porsche Cayenne EV ($379/day): 5 seats, luxury electric SUV, premium comfort and performance
   - Porsche Taycan ($349/day): 4 seats, electric sports car, thrilling driving experience

2. BOOKING QUESTIONS - Help with:
   - Rental periods and pricing
   - Pickup and return processes
   - Insurance and coverage options
   - Required documents (valid driver's license, credit card)
   - Age requirements (typically 21+)

3. GENERAL INQUIRIES:
   - Charging information (all vehicles come fully charged)
   - Mileage policies
   - Cancellation policies (flexible cancellations)
   - 24/7 customer support availability

Be friendly, concise, and helpful. If you don't know something specific about our policies, suggest the customer contact support for details. Always highlight the electric/sustainable aspect of our fleet.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: VEHICLE_CONTEXT },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limits exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required, please add funds to your workspace." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
