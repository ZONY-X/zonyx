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
const DECLINED_MESSAGE="Your rental payment is complete, but your card issuer declined the security-deposit hold. Nothing was charged for the deposit and your rental will not be charged again. Enter another card, or re-enter this card after contacting your bank, then select Authorize deposit.";
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
  const [depositAmount,setDepositAmount]=useState(0), [rentalFirst,setRentalFirst]=useState(false);
  const [message,setMessage]=useState("Loading secure card checkout…"), [confirmed,setConfirmed]=useState(false);
  const enabled=import.meta.env.VITE_SQUARE_CHECKOUT_ENABLED === "true";
  useEffect(()=>{
    if(!enabled || !user || !bookingId || !agreementId) return;
    setReady(false);setAttempted(false);setConfirmed(false);setPaymentId(undefined);setPhase("hold");
    let disposed=false; let mounted:Card|undefined;
    void (async()=>{
      try {
        const config=await squareAction({action:"config",bookingId,agreementId});
        if(disposed)return;
        if(config.manualDepositRequired) {setMessage("This reservation needs a separate deposit procedure approved by ZONYX before payment. Contact support@gozonyx.com. No card authorization or charge was submitted.");return;}
        if(import.meta.env.VITE_SQUARE_ENVIRONMENT === "live" && config.environment !== "live") throw new Error("Checkout environment is unavailable. No payment was started.");
        const paymentThenHold=config.checkoutSequence === "rental_then_hold";
        setRentalFirst(paymentThenHold);setDepositAmount(config.depositAmountCents);
        setRentalAmount(config.amountCents);setAmount(paymentThenHold?config.amountCents:config.depositAmountCents);
        if(paymentThenHold) setPhase("rental");
        if(config.existingPayment) {
          setPaymentId(config.existingPayment.id);
          if(paymentThenHold && !config.canPayRental && !config.canAuthorizeDeposit) {
            // A refresh after payment must show the confirmed booking, never another payment form.
            const current=await squareAction({action:"status",paymentId:config.existingPayment.id});
            if(disposed)return;
            if(current.bookingConfirmed) {setConfirmed(true);return;}
          }
          if(paymentThenHold && config.canAuthorizeDeposit) {setPhase("hold");setAmount(config.depositAmountCents);}
          else {
            if(!config.canPayRental) {setAttempted(true);setMessage("An existing Square payment needs a status check. Do not start another payment.");return;}
            setPhase("rental");setAmount(config.amountCents);
          }
        }
        const sdk=await loadSquare();mounted=await sdk.payments(config.applicationId,config.locationId).card();
        if(disposed){await mounted.destroy();return;}
        if(!host.current)throw new Error("Secure card form unavailable.");
        await mounted.attach(host.current);card.current=mounted;
        setReady(true);setMessage(paymentThenHold
          ? config.existingPayment && config.depositAttemptDeclined ? DECLINED_MESSAGE : config.existingPayment ? "Your rental payment is recorded. Authorize the security deposit again; your rental will not be charged twice."
            : ""
          : config.existingPayment ? "Deposit authorized. Approve the separate rental charge to continue." : "Authorize the refundable security deposit as a temporary card hold. It will not be charged.");
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
      // Obtain both single-use card tokens BEFORE charging the rental. A failed
      // second tokenization must not leave the customer with a paid rental and no hold.
      let depositToken: string | undefined;
      if(rentalFirst && phase==="rental") {
        const second=await card.current.tokenize({amount:(depositAmount/100).toFixed(2),currencyCode:"USD",intent:"CHARGE",customerInitiated:true,sellerKeyedIn:false,billingContact:{email:user?.email}});
        if(second.status!=="OK" || !second.token) throw new Error("Security-deposit card verification failed. No rental payment was submitted.");
        depositToken=second.token;
      }
      setAttempted(true); // Never unlock a financial POST after an uncertain response.
      const result=await squareAction({action:phase,bookingId,agreementId,paymentId,token:token.token});
      setPaymentId(result.paymentId);
      if(rentalFirst && phase==="rental" && result.state==="paid" && result.canAuthorizeDeposit) {
        setPhase("hold");setAmount(depositAmount);
        setMessage("Processing your payment…");
        await authorizeDeposit(result.paymentId,depositToken);
      } else if(rentalFirst && phase==="hold") {
        showDepositResult(result);
      } else if(!rentalFirst && phase==="hold" && result.depositStatus==="authorized") {
        setPhase("rental");setAmount(rentalAmount);setAttempted(false);
        setMessage("Deposit authorized. Approve the separate rental charge to continue.");
      } else if(result.bookingConfirmed) setConfirmed(true);
      else setMessage("Payment needs reconciliation. Check the existing payment before continuing.");
    } catch(error) {setMessage(error instanceof Error?error.message:"Check the existing payment before retrying.");}
    finally {lock.current=false;setBusy(false);}
  }
  function showDepositResult(result:{bookingConfirmed?:boolean;canAuthorizeDeposit?:boolean;depositStatus?:string}) {
    if(result.bookingConfirmed) setConfirmed(true);
    else if(result.canAuthorizeDeposit) {setAttempted(false);setMessage(DECLINED_MESSAGE);}
    else setMessage("Rental payment recorded. Deposit outcome needs a status check. Your reservation remains pending; do not pay the rental again.");
  }
  async function authorizeDeposit(id:string, token?:string) {
    // The rental and deposit have distinct, one-time tokens; no extra customer click.
    if(!token) throw new Error("Deposit verification unavailable. Rental was recorded; check the existing payment before retrying the deposit.");
    showDepositResult(await squareAction({action:"hold",bookingId,agreementId,paymentId:id,token}));
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
      if(result.bookingConfirmed) setConfirmed(true);
      else {
        setMessage(`Rental: ${result.state}. Deposit: ${result.depositStatus}.`);
        // A recovered hold may continue only if the server proves rental was never dispatched.
        const config=await squareAction({action:"config",bookingId,agreementId});
        if(config.checkoutSequence==="rental_then_hold" && config.canAuthorizeDeposit) {
          setRentalFirst(true);setPhase("hold");setAmount(config.depositAmountCents);setAttempted(false);
          if(!ready) {window.location.reload();return;}
          setMessage(config.depositAttemptDeclined ? DECLINED_MESSAGE : "Rental payment verified. Retry only the security-deposit authorization; the rental will not be charged again.");
        } else if(config.canPayRental && ready) {setPhase("rental");setAmount(config.amountCents);setAttempted(false);setMessage("Deposit authorized. Approve the separate rental charge to continue.");}
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
  if(confirmed && enabled) return <MainLayout variant="booking"><div className="container max-w-xl pb-16 pt-36 text-center" role="status"><p className="text-3xl font-bold">✓ Booking Confirmed!</p><p className="mt-4">Your reservation is confirmed.</p><p className="mt-2 text-sm text-muted-foreground">Booking reference: {bookingId}</p></div></MainLayout>;
  const recovery=rentalFirst && phase==="hold";
  return <MainLayout variant="booking"><div className="container max-w-xl pb-16 pt-36"><ZonyxPayHeader title="Complete your reservation" description="Card information" />
    {checkoutMessage && <p role="status" className="my-6">{checkoutMessage}</p>}
    {enabled && !hasReservation && <Button asChild><Link to="/fleet">Choose your Tesla</Link></Button>}
    {enabled && hasReservation && !user && <Button asChild><Link to="/auth">Sign in to continue</Link></Button>}
    <div ref={host} />
    {enabled && ready && <Button disabled={busy || attempted} onClick={()=>void submit()}>{recovery?"Retry deposit authorization":"Pay"}</Button>}
    {enabled && ready && !recovery && <p className="mt-3 text-sm text-muted-foreground">A refundable security deposit may be temporarily authorized on your card.</p>}
    {enabled && attempted && !busy && <Button variant="outline" className="ml-3" onClick={()=>void status()}>Check existing payment</Button>}
    {hasReservation && user && !attempted && !paymentId && internalPayPalCheckoutEnabled(false) && <p className="mt-6"><Link to={`/booking/payment?${new URLSearchParams({bookingId,agreementId})}`}>Use alternative PayPal checkout</Link></p>}
  </div></MainLayout>;
}
