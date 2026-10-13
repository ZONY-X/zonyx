import paypalLogo from "@/assets/paypal-logo.svg";

export function PayPalMark({ className = "h-6" }: { className?: string }) {
  return <img src={paypalLogo} alt="PayPal" className={`w-auto ${className}`} />;
}
