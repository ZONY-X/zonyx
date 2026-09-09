import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Summary = { reconciled:boolean; original_trip_amount_cents:number; adjustments_cents:number; after_trip_charges_cents:number; final_trip_total_cents:number; amount_paid_cents:number; refunds_credits_cents:number; net_trip_payments_cents:number; deposit_authorized_cents:number; deposit_captured_cents:number; deposit_released_cents:number; deposit_refunded_cents:number; net_deposit_retained_cents:number; balance_cents:number; deposit_settled:boolean };
const money=(value:number|undefined)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format((value||0)/100);

export function BookingFinancialSummary({bookingId}:{bookingId:string}){
  const{data,isLoading}=useQuery({queryKey:["booking-financial-summary",bookingId],queryFn:async()=>{const{data,error}=await supabase.rpc("get_booking_financial_summary",{_booking_id:bookingId});if(error)throw error;return data as unknown as Summary;},enabled:!!bookingId});
  if(isLoading)return <p className="text-xs text-muted-foreground">Loading financial summary…</p>;
  if(!data?.reconciled)return null;
  return <Card><CardHeader><CardTitle className="text-base">Reconciled Financial Summary</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm sm:grid-cols-3">
    <div><p className="text-muted-foreground">Original trip</p><p className="font-medium">{money(data.original_trip_amount_cents)}</p></div>
    <div><p className="text-muted-foreground">Adjustments</p><p className="font-medium">{money(data.adjustments_cents)}</p></div>
    {data.after_trip_charges_cents>0&&<div><p className="text-muted-foreground">After-trip charges</p><p className="font-medium">{money(data.after_trip_charges_cents)}</p></div>}
    <div><p className="text-muted-foreground">Final trip total</p><p className="font-medium">{money(data.final_trip_total_cents)}</p></div>
    <div><p className="text-muted-foreground">Paid</p><p className="font-medium">{money(data.amount_paid_cents)}</p></div>
    <div><p className="text-muted-foreground">Refunds / credits</p><p className="font-medium">{money(data.refunds_credits_cents)}</p></div>
    <div><p className="text-muted-foreground">Balance</p><p className="font-medium">{money(data.balance_cents)}</p></div>
    <div><p className="text-muted-foreground">Deposit authorized</p><p className="font-medium">{money(data.deposit_authorized_cents)}</p></div>
    <div><p className="text-muted-foreground">Deposit captured / released</p><p className="font-medium">{money(data.deposit_captured_cents)} / {money(data.deposit_released_cents)}</p></div>
    <div><p className="text-muted-foreground">Deposit refunded / status</p><p className="font-medium">{money(data.deposit_refunded_cents)} / {data.deposit_settled?"Settled":"Open"}</p></div>
  </CardContent></Card>;
}