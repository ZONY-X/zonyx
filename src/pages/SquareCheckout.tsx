import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { squareAction, internalPayPalCheckoutEnabled } from "@/lib/payments";
import { useAuth } from "@/hooks/useAuth";
import { SquareInstalledCheckout } from "@/components/rental/SquareInstalledCheckout";
import { ZonyxPayHeader } from "@/components/rental/ZonyxPayHeader";

type Card = { attach(element: HTMLElement): Promise<void>; destroy(): Promise<void>; tokenize(details: {amount:string;currencyCode:string;intent:string;customerInitiated:boolean;sellerKeyedIn:boolean;billingContact:{email?:string}}): Promise<{status:string;token?:string}> };
type SquareSDK = { payments(app:string, location:string): {card():Promise<Card>} };
let sdkPromise: Promise<SquareSDK> | undefined;
function loadSquare() {
  return sdkPromise ??= new Promise<SquareSDK>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = import.meta.env.VITE_SQUARE_ENVIRONMENT === "live" ? "https://web.squarecdn.com/v1/square.js" : "https://sandbox.web.squarecdn.com/v1/square.js";
    script.onload = () => { const sdk=(window as Window & {Square?:SquareSDK}).Square; if(sdk) resolve(sdk); else reject(new Error("Secure card form unavailable.")); };
    script.onerror = () => { sdkPromise=undefined; reject(new Error("Secure card form unavailable.")); };
    document.head.appendChild(script);
  });
}
export default function SquareCheckout() {
  const [params]=useSearchParams(), { user }=useAuth();
  const bookingId=params.get("bookingId") || "", agreementId=params.get("agreementId") || "";
  const host=useRef<HTMLDivElement>(null), card=useRef<Card>(), lock=useRef(false);
  const [busy,setBusy]=useState(false), [ready,setReady]=useState(false), [attempted,setAttempted]=useState(false);
  const [paymentId,setPaymentId]=useState<string>(), [phase,setPhase]=useState<"hold"|"rental">("hold");
  const [amount,setAmount]=useState(0), [rentalAmount,setRentalAmount]=useState(0);
  const [message,setMessage]=useState("Loading secure card checkout…");
  const enabled=import.meta.env.VITE_SQUARE_CHECKOUT_ENABLED === "true";
  useEffect(()=>{
    if(!enabled || !user || !bookingId || !agreementId) return;
    setReady(false);setAttempted(false);setPaymentId(undefined);setPhase("hold");
    let disposed=false; let mounted:Card|undefined;
    void (async()=>{
      try {
        const config=await squareAction({action:"config",bookingId,agreementId});
        if(disposed)return;
        if(config.manualDepositRequired) {setMessage("This reservation needs a separate deposit procedure approved by ZONYX before payment. Contact support@gozonyx.com. No card authorization or charge was submitted.");return;}
        if(import.meta.env.VITE_SQUARE_ENVIRONMENT === "live" && config.environment !== "live") throw new Error("Checkout environment is unavailable. No payment was started.");
        setRentalAmount(config.amountCents);setAmount(config.depositAmountCents);
        if(config.existingPayment) {
          setPaymentId(config.existingPayment.id);
          if(!config.canPayRental) {setAttempted(true);setMessage("An existing Square payment needs a status check. Do not start another payment.");return;}
          setPhase("rental");setAmount(config.amountCents);
        }
        const sdk=await loadSquare();mounted=await sdk.payments(config.applicationId,config.locationId).card();
        if(disposed){await mounted.destroy();return;}
        if(!host.current)throw new Error("Secure card form unavailable.");
        await mounted.attach(host.current);card.current=mounted;
        setReady(true);setMessage(config.existingPayment ? "Deposit authorized. Approve the separate rental charge to continue." : "Authorize the refundable security deposit as a temporary card hold. It will not be charged.");
      } catch(error) {if(!disposed)setMessage(error instanceof Error?error.message:"Checkout unavailable.");}
    })();
    return ()=>{disposed=true;card.current=undefined;if(mounted)void mounted.destroy();};
  },[enabled,user,bookingId,agreementId]);
  async function submit() {
    if(lock.current || !card.current || attempted)return;
    lock.current=true;setBusy(true);
    try {
      const token=await card.current.tokenize({amount:(amount/100).toFixed(2),currencyCode:"USD",intent:"CHARGE",customerInitiated:true,sellerKeyedIn:false,billingContact:{email:user?.email}});
      if(token.status!=="OK" || !token.token)throw new Error("Card verification was unsuccessful. Review the card form.");
      setAttempted(true); // Never unlock a financial POST after an uncertain response.
      const result=await squareAction({action:phase,bookingId,agreementId,paymentId,token:token.token});
      setPaymentId(result.paymentId);
      if(phase==="hold" && result.depositStatus==="authorized") {
        setPhase("rental");setAmount(rentalAmount);setAttempted(false);
        setMessage("Deposit authorized. Approve the separate rental charge to continue.");
      } else setMessage(result.bookingConfirmed ? "Booking confirmed. Your security deposit remains a temporary hold." : "Payment needs reconciliation. Check the existing payment before continuing.");
    } catch(error) {setMessage(error instanceof Error?error.message:"Check the existing payment before retrying.");}
    finally {lock.current=false;setBusy(false);}
  }
  async function status() {
    if(lock.current)return;lock.current=true;setBusy(true);
    try {
      let id=paymentId;
      if(!id) {
        const config=await squareAction({action:"config",bookingId,agreementId});
        id=config.existingPayment?.id;
        if(!id)throw new Error("No payment reservation found. Reload checkout to continue.");
        setPaymentId(id);
      }
      const result=await squareAction({action:"status",paymentId:id});
      if(result.bookingConfirmed) setMessage("Booking confirmed. Your security deposit remains a temporary hold.");
      else {
        setMessage(`Rental: ${result.state}. Deposit: ${result.depositStatus}.`);
        // A recovered hold may continue only if the server proves rental was never dispatched.
        const config=await squareAction({action:"config",bookingId,agreementId});
        if(config.canPayRental && ready) {setPhase("rental");setAmount(config.amountCents);setAttempted(false);setMessage("Deposit authorized. Approve the separate rental charge to continue.");}
      }
    }
    catch(error){setMessage(error instanceof Error?error.message:"Status unavailable.");}
    finally{lock.current=false;setBusy(false);}
  }
  if (import.meta.env.VITE_SQUARE_INSTALLED === "true" && !enabled) return <SquareInstalledCheckout />;
  const hasReservation = Boolean(bookingId && agreementId);
  const checkoutMessage = !enabled ? "Square checkout is awaiting activation. No payment was started."
    : !hasReservation ? "Card payments are available. Choose a vehicle and complete your rental agreement to open your secure checkout."
    : !user ? "Sign in to the account used for this reservation to continue with secure checkout."
    : message;
  return <MainLayout variant="booking"><div className="container max-w-xl pb-16 pt-36"><ZonyxPayHeader title="Complete your reservation" description="Secure rental payment and a separate temporary security-deposit authorization." bookingId={bookingId} />
    <p role="status" className="my-6">{checkoutMessage}</p>
    {enabled && !hasReservation && <Button asChild><Link to="/fleet">Choose your Tesla</Link></Button>}
    {enabled && hasReservation && !user && <Button asChild><Link to="/auth">Sign in to continue</Link></Button>}
    <div ref={host} />
    {enabled && ready && <Button disabled={busy || attempted} onClick={()=>void submit()}>{phase==="hold"?"Authorize deposit":"Pay rental"} · ${(amount/100).toFixed(2)}</Button>}
    {(paymentId || attempted) && <Button disabled={busy} onClick={()=>void status()}>Check existing payment</Button>}
    {hasReservation && user && !attempted && !paymentId && internalPayPalCheckoutEnabled(false) && <p className="mt-6"><Link to={`/booking/payment?${new URLSearchParams({bookingId,agreementId})}`}>Use alternative PayPal checkout</Link></p>}
  </div></MainLayout>;
}
