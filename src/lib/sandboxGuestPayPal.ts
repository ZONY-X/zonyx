export function sandboxGuestPayPalUiEnabled() {
  return import.meta.env.VITE_GUEST_PAYPAL_SANDBOX_ENABLED === "true" &&
    import.meta.env.VITE_PAYPAL_STANDARD_CHECKOUT_ENABLED === "true" &&
    import.meta.env.VITE_SUPABASE_URL === "https://pvowzjqimikcoyjwclez.supabase.co";
}

// Embedded checkout is isolated from Standard wallet approval and from LIVE.
export function sandboxCardCheckoutUiEnabled() {
  return import.meta.env.VITE_PAYPAL_SANDBOX_CARD_ENABLED === "true" &&
    import.meta.env.VITE_GUEST_PAYPAL_SANDBOX_ENABLED === "true" &&
    import.meta.env.VITE_SUPABASE_URL === "https://pvowzjqimikcoyjwclez.supabase.co";
}
