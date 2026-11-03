import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { PayPalClient } from "../_shared/paypal-client.ts";
import { assertPayPalProviderLockReady, assertCardCaptureEligible, assertStandardApproval, approvalUrl, standardPayPalEnabled, customerPayPalEnabled, PaymentError } from "../_shared/payment-policy.ts";
import { Deposit, persistDepositAuthorization, validateDepositOrder } from "../_shared/paypal-deposit.ts";
import { authenticate, corsHeaders, env, json, ownedPayment, paymentFailure, rpc, serviceClient, validateBooking, validateRentalEligibility } from "../_shared/payment-service.ts";

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, {status:204, headers:corsHeaders});
  if (request.method !== "POST") return json(405, {error:"Method not allowed."});
  try {
    assertPayPalProviderLockReady(env);
    if (!customerPayPalEnabled(env) && (env("SUPABASE_URL") !== "https://pvowzjqimikcoyjwclez.supabase.co" ||
        env("PAYPAL_ENVIRONMENT") !== "sandbox" || env("PAYPAL_SANDBOX_DEPOSIT_ENABLED") !== "true" ||
        env("PAYPAL_RENTAL_CHECKOUT_ENABLED") !== "true" || (env("PAYPAL_ADVANCED_CARD_ENABLED") !== "true" && !standardPayPalEnabled(env)))) {
      throw new PaymentError(503, "Sandbox deposit authorization is disabled.");
    }
    const schedulerAuthorized = Boolean(env("PAYPAL_DEPOSIT_SCHEDULER_SECRET")) &&
      request.headers.get("x-zonyx-scheduler-secret") === env("PAYPAL_DEPOSIT_SCHEDULER_SECRET");
    const user = schedulerAuthorized ? null : await authenticate(request), input = await request.json();
    if (!input || Object.keys(input).some(key => !["action","paymentId","paymentSourceId"].includes(key)) ||
        !["create","authorize","status","release","auto-authorize"].includes(input.action) || typeof input.paymentId !== "string") {
      throw new PaymentError(400,"Only an existing rental payment identifier is accepted.");
    }
    const db = serviceClient();
    const payment = schedulerAuthorized && input.action === "auto-authorize"
      ? (await db.from("booking_payments").select("*").eq("id", input.paymentId).eq("provider", "paypal").single()).data
      : await ownedPayment(db,input.paymentId,user!.id,input.action === "status" || input.action === "release");
    if (!payment) throw new PaymentError(404, "Rental payment not found.");
    if (payment.environment !== env("PAYPAL_ENVIRONMENT") || payment.state !== "paid") throw new PaymentError(409,"Verified sandbox rental payment required.");
    const paypal = new PayPalClient(env);
    if (input.action === "auto-authorize") {
      if (!schedulerAuthorized && typeof input.paymentSourceId !== "string") {
        throw new PaymentError(400, "A saved PayPal payment method is required.");
      }
      const { data: booking, error: bookingError } = await db.from("bookings")
        .select("renter_profile_id").eq("id", payment.booking_id).single();
      const { data: profile, error: profileError } = await db.from("profiles")
        .select("id").eq(schedulerAuthorized ? "id" : "user_id", schedulerAuthorized ? booking?.renter_profile_id : user!.id).maybeSingle();
      const { data: consent, error: consentError } = await db.from("paypal_payment_consents")
        .select("id,payment_source_id,booking_id")
        .eq("booking_id", payment.booking_id)
        .eq("scope", "after_trip_charges")
        .is("revoked_at", null)
        .maybeSingle();
      const sourceId = schedulerAuthorized ? consent?.payment_source_id : input.paymentSourceId;
      const { data: source, error: sourceError } = await db.from("paypal_payment_sources")
        .select("id,profile_id,vault_token,status,environment")
        .eq("id", sourceId || "")
        .maybeSingle();
      if (
        bookingError || !booking || profileError || !profile || sourceError || !source ||
        source.profile_id !== profile.id || source.status !== "active" ||
        source.environment !== paypal.environment
      ) throw new PaymentError(409, "Saved PayPal payment method is unavailable.");
      if (consentError || !consent || consent.payment_source_id !== source.id ||
          (consent.booking_id !== null && consent.booking_id !== payment.booking_id)) {
        throw new PaymentError(409, "Saved PayPal payment consent is required for this booking.");
      }
      const prepared = await rpc<{deposit: Deposit; dispatch: boolean}>(db, "prepare_paypal_sandbox_deposit", {
        _payment_id: payment.id,
      });
      let deposit = prepared.deposit;
      if (!prepared.dispatch && deposit.operation_state === "complete") {
        return json(200, { depositStatus: deposit.status, bookingConfirmed: false });
      }
      if (!prepared.dispatch || deposit.operation_state !== "awaiting_approval") {
        throw new PaymentError(409, "Deposit is not ready for automatic authorization.");
      }
      const order = await paypal.createOrder({
        intent: "AUTHORIZE",
        purchase_units: [{
          reference_id: deposit.id,
          custom_id: deposit.id,
          invoice_id: deposit.id,
          amount: {
            currency_code: deposit.currency.toUpperCase(),
            value: (Number(deposit.amount_cents) / 100).toFixed(2),
          },
        }],
        payment_source: {
          card: {
            attributes: {
              vault: {
                id: source.vault_token,
                usage_type: "MERCHANT",
                customer_type: "CONSUMER",
              },
              stored_credential: {
                payment_initiator: "MERCHANT",
                usage: "SUBSEQUENT",
              },
            },
            experience_context: { shipping_preference: "NO_SHIPPING" },
          },
        },
      }, deposit.create_request_id);
      validateDepositOrder(order, deposit);
      await rpc(db, "attach_paypal_sandbox_deposit", {
        _deposit_id: deposit.id,
        _order_id: order.id,
      });
      await rpc(db, "claim_paypal_sandbox_authorization", { _deposit_id: deposit.id });
      await paypal.authorizeOrder(order.id, deposit.authorize_request_id);
      const canonical = await paypal.getOrder(order.id);
      return json(200, await persistDepositAuthorization(db, payment, deposit, canonical));
    }
    const standard = payment.checkout_method === "paypal_wallet";
    if (input.action !== "status" && input.action !== "release" && standard && !standardPayPalEnabled(env)) throw new PaymentError(403,"PayPal Standard deposit authorization is disabled.");
    if (input.action === "create" && !standard && env("PAYPAL_ADVANCED_CARD_ENABLED") !== "true") throw new PaymentError(403,"Advanced card authorization is disabled.");
    let deposit: Deposit;
    if (input.action === "create") {
      const returnOrigin = standard ? new URL(env("PAYPAL_CHECKOUT_RETURN_ORIGIN") || "") : undefined;
      if (returnOrigin && (returnOrigin.origin !== env("PAYPAL_CHECKOUT_RETURN_ORIGIN") || (returnOrigin.protocol !== "https:" && !(paypal.environment === "sandbox" && ["localhost","127.0.0.1"].includes(returnOrigin.hostname))))) throw new PaymentError(503,"A trusted checkout return origin must be configured.");
      const returnUrl = returnOrigin ? new URL("/booking/paypal/return",returnOrigin) : undefined;
      if (returnUrl) { returnUrl.searchParams.set("payment_id",payment.id); returnUrl.searchParams.set("phase","deposit"); returnUrl.searchParams.set("bookingId",payment.booking_id); returnUrl.searchParams.set("agreementId",payment.agreement_id); }
      const cancelUrl = returnUrl ? new URL(returnUrl) : undefined;
      cancelUrl?.searchParams.set("cancelled","true");
      const prepared = await rpc<{deposit:Deposit;dispatch:boolean}>(db,"prepare_paypal_sandbox_deposit",{_payment_id:payment.id});
      deposit = prepared.deposit;
      if (!prepared.dispatch) {
        if (deposit.operation_state === "awaiting_approval" && deposit.provider_order_id) {
          const existing = standard ? await paypal.getOrder(deposit.provider_order_id) : undefined;
          if (existing) {
            const authorization = validateDepositOrder(existing,deposit);
            if (authorization) return json(200,await persistDepositAuthorization(db,payment,deposit,existing));
            if (existing.status === "APPROVED") { assertStandardApproval(existing); return json(200,{orderId:existing.id,approvalReady:true}); }
          }
          return json(200,{orderId:deposit.provider_order_id,depositId:deposit.id,amountCents:Number(deposit.amount_cents),url:existing ? approvalUrl(existing,paypal.environment) : undefined});
        }
        throw new PaymentError(409,"An existing deposit requires a status check. No new authorization was created.");
      }
      // Claim persists before provider HTTP. A lost response never creates another order.
      const order = await paypal.createOrder({intent:"AUTHORIZE",purchase_units:[{
        reference_id:deposit.id,custom_id:deposit.id,invoice_id:deposit.id,
        amount:{currency_code:deposit.currency.toUpperCase(),value:(Number(deposit.amount_cents)/100).toFixed(2)},
      }],payment_source:standard ? {paypal:{experience_context:{user_action:"CONTINUE",shipping_preference:"NO_SHIPPING",return_url:returnUrl!.toString(),cancel_url:cancelUrl!.toString()}}} : {card:{attributes:{verification:{method:"SCA_ALWAYS"}},experience_context:{shipping_preference:"NO_SHIPPING"}}}},deposit.create_request_id);
      validateDepositOrder(order,deposit);
      await rpc(db,"attach_paypal_sandbox_deposit",{_deposit_id:deposit.id,_order_id:order.id});
      return json(200,{orderId:order.id,depositId:deposit.id,amountCents:Number(deposit.amount_cents),url:standard ? approvalUrl(order,paypal.environment) : undefined});
    }
    const {data,error} = await db.from("booking_security_deposits").select("*").eq("rental_payment_id",payment.id).eq("generation",1).single();
    if (error || !data?.provider_order_id) throw new PaymentError(409,"Existing deposit identity requires reconciliation.");
    deposit = data as Deposit;
    let order = await paypal.getOrder(deposit.provider_order_id!);
    const authorization = validateDepositOrder(order,deposit);
    if (authorization?.status === "VOIDED") {
      await rpc(db,"record_paypal_sandbox_deposit_void",{_deposit_id:deposit.id,_order_id:order.id,_authorization_id:authorization.id});
      return json(200,{depositStatus:"voided",bookingConfirmed:false,reconciliationRequired:true});
    }
    if (input.action === "release") {
      if (user.id !== "52af03eb-1976-4db0-900a-6509b1c8405b" || !authorization || authorization.status !== "CREATED" || deposit.provider_authorization_id !== authorization.id) throw new PaymentError(403,"Verified synthetic authorization required for test release.");
      await rpc(db,"claim_paypal_sandbox_deposit_release",{_deposit_id:deposit.id});
      await paypal.voidAuthorization(authorization.id,deposit.authorize_request_id);
      order = await paypal.getOrder(deposit.provider_order_id!);
      if (validateDepositOrder(order,deposit)?.status !== "VOIDED") throw new PaymentError(409,"Release requires canonical reconciliation.");
      await rpc(db,"record_paypal_sandbox_deposit_void",{_deposit_id:deposit.id,_order_id:order.id,_authorization_id:authorization.id});
      return json(200,{depositStatus:"voided",bookingConfirmed:false,reconciliationRequired:true});
    }
    if (authorization && (["EXPIRED","VOIDED"].includes(authorization.status) || Date.parse(authorization.create_time)+3*86400000<=Date.now())) {
      return json(200,await rpc(db,"refresh_paypal_deposit_coverage",{_deposit_id:deposit.id,_authorization_id:authorization.id,_provider_status:authorization.status,_expires_at:authorization.expiration_time}));
    }
    if (authorization) return json(200,await persistDepositAuthorization(db,payment,deposit,order));
    if (input.action === "status") return json(200,{depositStatus:deposit.status,operationState:deposit.operation_state,authorizationDueAt:deposit.authorization_due_at,bookingConfirmed:false});
    if (deposit.operation_state !== "awaiting_approval" || !["CREATED","APPROVED"].includes(order.status)) {
      throw new PaymentError(409,"Authorization outcome needs reconciliation. No retry was sent.");
    }
    if (standard) assertStandardApproval(order);
    else { if (env("PAYPAL_ADVANCED_CARD_ENABLED") !== "true") throw new PaymentError(403,"Advanced card authorization is disabled."); assertCardCaptureEligible(order); }
    const booking = await validateBooking(db,payment.booking_id,payment.agreement_id,user.id);
    await validateRentalEligibility(request,db,booking);
    await rpc(db,"claim_paypal_sandbox_authorization",{_deposit_id:deposit.id});
    await paypal.authorizeOrder(deposit.provider_order_id!,deposit.authorize_request_id);
    order = await paypal.getOrder(deposit.provider_order_id!);
    return json(200,await persistDepositAuthorization(db,payment,deposit,order));
  } catch(error) { return paymentFailure(error); }
});
