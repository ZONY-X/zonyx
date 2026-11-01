// Synthetic values, used only by offline tests.
export const readyEnvironment = (key: string): string | undefined => ({
  SQUARE_ENVIRONMENT: "sandbox", SUPABASE_URL: "https://pvowzjqimikcoyjwclez.supabase.co",
  SQUARE_SANDBOX_PROJECT_URL: "https://pvowzjqimikcoyjwclez.supabase.co",
  SQUARE_CHECKOUT_ENABLED: "true", SQUARE_PROVIDER_LOCK_READY: "true",
  SQUARE_SANDBOX_ACCESS_TOKEN: "synthetic", SQUARE_SANDBOX_LOCATION_ID: "synthetic", SQUARE_SANDBOX_APPLICATION_ID: "synthetic",
  PAYPAL_ENVIRONMENT: "sandbox", PAYPAL_RENTAL_CHECKOUT_ENABLED: "true", PAYPAL_PROVIDER_LOCK_READY: "true", PAYPAL_WEBHOOK_ID: "synthetic",
  PAYPAL_SANDBOX_CLIENT_ID: "synthetic", PAYPAL_SANDBOX_CLIENT_SECRET: "synthetic",
} as Record<string,string>)[key];
