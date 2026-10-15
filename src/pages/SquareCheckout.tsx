import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { squareAction, internalPayPalCheckoutEnabled } from "@/lib/payments";
import { useAuth } from "@/hooks/useAuth";
import { SquareInstalledCheckout } from "@/components/rental/SquareInstalledCheckout";
import { ZonyxPayBrand } from "@/components/rental/ZonyxPayBrand";
import { Loader2 } from "lucide-react";
import { PayPalMark } from "@/components/rental/PayPalMark";

type Card = { attach(element: HTMLElement): Promise<void>; destroy(): Promise<void>; tokenize(details: {amount:string;currencyCode:string;intent:string;customerInitiated:boolean;sellerKeyedIn:boolean;billingContact:{email?:string}}): Promise<{status:string;token?:string}> };
type SquareSDK = { payments(app:string, location:string): {card(options?:{style?:Record<string,unknown>}):Promise<Card>} };
const CARD_STYLE={
  ".input-container":{borderColor:"#2a2a2a",borderRadius:"12px"},
  ".input-container.is-focus":{borderColor:"#0fd8c4"},
  ".input-container.is-error":{borderColor:"#f87171"},
  ".message-text":{color:"#9ca3af"},
  ".message-icon":{color:"#9ca3af"},
  input:{backgroundColor:"#0b0b0b",color:"#ffffff",fontSize:"18px",fontWeight:"500"},
  "input.is-error":{color:"#f87171"},
  "input::placeholder":{color:"#6b7280"},
};
const MAC_SAFARI=typeof navigator!=="undefined" && /Macintosh/.test(navigator.userAgent) && /Version\/[\d.]+.*Safari\//.test(navigator.userAgent);
let sdkPromise: Promise<SquareSDK> | undefined;
const DECLINED_MESSAGE="Your rental payment is complete, but your card issuer declined the security-deposit hold. Nothing was charged for the deposit and your rental will not be charged again. Enter another card, or re-enter this card after contacting your bank, then retry.";
// Temporary read-only layout diagnostics, enabled only by ?sqdebug=1; never reads card data.
const SQ_DEBUG=typeof window!=="undefined" && new URLSearchParams(window.location.search).get("sqdebug")==="1";
let sqMounts=0;
const t0=typeof performance!=="undefined"?performance.now():0;
const rect=(e?:Element|null)=>{if(!e)return "none";const r=e.getBoundingClientRect();return `x${Math.round(r.x)} y${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;};
function thirdParty() {
  const w=window as Window & {__zonyxNoThirdParty?:boolean;clarity?:unknown;fbq?:unknown};
  const has=(s:string)=>!!document.querySelector(`script[src*="${s}"]`);
  return `nothirdparty=${!!w.__zonyxNoThirdParty} | clarity: fn=${typeof w.clarity} script=${has("clarity.ms")} | metaPixel: fbq=${typeof w.fbq} script=${has("fbevents.js")}`;
}
function measure(label:string,hostEl:HTMLElement|null,slotEl?:HTMLElement|null) {
  const cs=(e:Element,p:string)=>getComputedStyle(e).getPropertyValue(p);
  const f=document.querySelector<HTMLIFrameElement>("iframe.sq-card-component")||hostEl?.querySelector("iframe")||null;
  const L=[`--- ${label} @${Math.round(performance.now()-t0)}ms mounts=${sqMounts} sqIframes=${document.querySelectorAll("iframe.sq-card-component").length}`,
    `viewport ${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio} vvScale=${window.visualViewport?.scale} readyState=${document.readyState}`,
    `host ${rect(hostEl)} colorScheme=${hostEl?cs(hostEl,"color-scheme"):""} display=${hostEl?cs(hostEl,"display"):""}`,
    `slot ${rect(slotEl)} wrapper ${rect(document.querySelector(".sq-card-wrapper"))}`,
    f?`iframe ${rect(f)} attr=${f.getAttribute("width")}x${f.getAttribute("height")} css=${cs(f,"width")}x${cs(f,"height")} display=${cs(f,"display")} colorScheme=${cs(f,"color-scheme")} zoom=${cs(f,"zoom")} transform=${cs(f,"transform")} bg=${cs(f,"background-color")} style="${f.getAttribute("style")||""}"`:"iframe none"];
  for(let e=hostEl?.parentElement;e&&e!==document.documentElement;e=e.parentElement) {
    const odd=["transform","zoom","filter","backdrop-filter","contain","overflow","color-scheme"].map(p=>`${p}=${cs(e,p)}`).filter(s=>!/=(none|normal|visible|1|auto)$/.test(s));
    L.push(`^ ${e.tagName.toLowerCase()} ${rect(e)} ${odd.join(" ")}`);
  }
  return L.join("\n");
}
// On a full reload Safari lays out the iframe before the page and fonts settle, leaving Square's card collapsed.
async function layoutSettled(el: HTMLElement) {
  if(document.readyState!=="complete") await new Promise<void>(r=>window.addEventListener("load",()=>r(),{once:true}));
  await document.fonts?.ready;
  for(let i=0;i<30 && el.getBoundingClientRect().width<1;i++) await new Promise(r=>setTimeout(r,50));
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
}
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
  const [dbg,setDbg]=useState<string[]>([]);
  const log=(s:string)=>{if(SQ_DEBUG)setDbg(d=>[...d,s]);};
  // Auth events replace the user object; keying on the stable id prevents re-mounting the card iframe.
  const userId=user?.id;
  useEffect(()=>{
    if(!enabled || !userId || !bookingId || !agreementId) return;
    setReady(false);setAttempted(false);setConfirmed(false);setPaymentId(undefined);setPhase("hold");
    let disposed=false; let mounted:Card|undefined; let slot:HTMLDivElement|undefined;
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
        log(`effect start @${Math.round(performance.now()-t0)}ms`);
        const sdk=await loadSquare();mounted=await sdk.payments(config.applicationId,config.locationId).card({style:CARD_STYLE});
        sqMounts++;log(`card() created @${Math.round(performance.now()-t0)}ms`);
        if(disposed){await mounted.destroy();return;}
        if(!host.current)throw new Error("Secure card form unavailable.");
        // A private slot per mount means a stale or half-attached iframe can never linger in the host.
        slot=document.createElement("div");host.current.replaceChildren(slot);
        await layoutSettled(host.current);
        if(disposed){await mounted.destroy();slot.remove();return;}
        log(measure("before attach",host.current,slot));
        await mounted.attach(slot);
        const hostEl=host.current,slotEl=slot;
        if(SQ_DEBUG) for(const ms of [0,1500,4000,8000]) setTimeout(()=>log(measure(`attach +${ms}ms`,hostEl,slotEl)),ms);
        if(disposed){await mounted.destroy();slot.remove();return;}
        card.current=mounted;
        setReady(true);setMessage(paymentThenHold
          ? config.existingPayment && config.depositAttemptDeclined ? DECLINED_MESSAGE : config.existingPayment ? "Your rental payment is recorded. Authorize the security deposit again; your rental will not be charged twice."
            : ""
          : config.existingPayment ? "Deposit authorized. Approve the separate rental charge to continue." : "Authorize the refundable security deposit as a temporary card hold. It will not be charged.");
      } catch(error) {if(!disposed)setMessage(error instanceof Error?error.message:"Checkout unavailable.");}
    })();
    return ()=>{disposed=true;card.current=undefined;const m=mounted,sl=slot;if(m)void m.destroy().finally(()=>sl?.remove());else sl?.remove();};
  },[enabled,userId,bookingId,agreementId]);
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
  const accent="bg-[#0fd8c4] text-[#031311] hover:bg-[#2fe6d3] focus-visible:ring-2 focus-visible:ring-[#0fd8c4] focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:bg-[#0fd8c4]/40 disabled:text-[#031311]/70 shadow-none hover:shadow-none";
  if(confirmed && enabled) return <MainLayout variant="booking"><main className="min-h-screen bg-black px-4 pb-28 pt-28 sm:pb-20 sm:pt-32"><div role="status" className="mx-auto w-full max-w-md rounded-2xl border border-white/10 bg-black p-6 text-center sm:p-8"><ZonyxPayBrand />
    <div className="my-8 h-px bg-white/10" />
    <span aria-hidden="true" className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-[#0fd8c4]/40 text-2xl text-[#0fd8c4]">✓</span>
    <h1 className="mt-5 text-2xl font-semibold text-white">Booking Confirmed</h1>
    <p className="mt-2 text-neutral-400">Your reservation is confirmed.</p>
    <p className="mt-6 break-all text-sm text-neutral-500">Booking reference: <span className="text-neutral-300">{bookingId}</span></p>
  </div></main></MainLayout>;
  const recovery=rentalFirst && phase==="hold";
  const declined=message===DECLINED_MESSAGE;
  const showPayPal=hasReservation && user && !attempted && !paymentId && !recovery && !busy && internalPayPalCheckoutEnabled(false);
  return <MainLayout variant="booking"><main className="min-h-screen bg-black px-4 pb-28 pt-28 sm:pb-20 sm:pt-32"><div className="mx-auto w-full max-w-md rounded-2xl border border-white/10 bg-black p-6 sm:p-8"><ZonyxPayBrand />
    <div className="my-6 h-px bg-white/10" />
    <h1 className="text-2xl font-semibold tracking-tight text-white">Complete Your Reservation</h1>
    {checkoutMessage && <p role="status" className={`mt-4 rounded-xl border px-4 py-3 text-sm ${declined?"border-amber-400/30 text-amber-200":"border-white/10 text-neutral-300"}`}>{checkoutMessage}</p>}
    {enabled && hasReservation && user && <div className={ready ? "mt-6" : ""}>
      {ready && <p className="mb-2 text-sm font-medium text-neutral-300">Card Information</p>}
      {/* Square's iframe document is light; a dark ancestor color-scheme makes browsers paint it opaque white. */}
      {/* Give desktop Safari's card iframe its own paint layer; keep its layout and SDK lifecycle unchanged. */}
      <div ref={host} className={`[color-scheme:light] ${MAC_SAFARI ? "[&_iframe.sq-card-component]:[transform:translateZ(0)]" : ""} ${ready ? "min-h-[96px]" : ""}`} />
    </div>}
    {enabled && !hasReservation && <Button asChild className={`mt-6 h-12 w-full rounded-xl text-base font-semibold ${accent}`}><Link to="/fleet">Choose your Tesla</Link></Button>}
    {enabled && hasReservation && !user && <Button asChild className={`mt-6 h-12 w-full rounded-xl text-base font-semibold ${accent}`}><Link to="/auth">Sign in to continue</Link></Button>}
    {enabled && ready && <Button disabled={busy || attempted} onClick={()=>void submit()} className={`mt-6 h-12 w-full rounded-xl text-base font-semibold transition-colors ${accent}`}>{busy?<><Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />Processing</>:recovery?"Retry deposit authorization":"Pay"}</Button>}
    {enabled && ready && !recovery && <p className="mt-4 text-center text-sm text-neutral-400">A refundable security deposit may be temporarily authorized on your card.</p>}
    {enabled && attempted && !busy && <Button variant="outline" onClick={()=>void status()} className="mt-4 h-11 w-full rounded-xl border-white/15 bg-transparent text-neutral-200 hover:bg-white/5 hover:text-white">Check existing payment</Button>}
    {showPayPal && <div className="mt-6 border-t border-white/10 pt-5"><p className="mb-3 text-center text-xs uppercase tracking-widest text-neutral-500">Or</p>
      <Button aria-label="Pay with PayPal (coming soon)" disabled className="h-12 w-full rounded-xl bg-[#ffc439] text-black shadow-none disabled:bg-[#ffc439] disabled:opacity-60"><PayPalMark className="h-6" /></Button>
      <p className="mt-2 text-center text-xs text-neutral-500">PayPal checkout is coming soon.</p></div>}
  </div>
  {SQ_DEBUG && <pre className="fixed inset-x-0 bottom-0 z-[9999] m-0 max-h-[45vh] overflow-auto whitespace-pre-wrap break-all bg-black/95 p-2 text-[10px] leading-tight text-lime-300" style={{colorScheme:"light"}}>{`SQDEBUG ${navigator.userAgent}\n${thirdParty()}\n`}{dbg.join("\n")}</pre>}
  </main></MainLayout>;
}
