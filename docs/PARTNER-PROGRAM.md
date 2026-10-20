# ZONYX Partner Program — operations

## URLs and access
- Public: https://www.gozonyx.com/partners
- Partner portal: https://www.gozonyx.com/partners/dashboard
- Admin: https://www.gozonyx.com/admin-dashboard → Partners

Existing ZONYX authentication is reused. Applications require a verified account email. Each account can apply once. No separate credentials or payment processor are introduced.

## Approve and onboard
Review business/contact details in Admin → Partners, then approve, reject or suspend. Reactivate with Approve. Approval creates a random unique referral code. The approved partner retrieves the code and URL in their secure dashboard. Reactivation retains the same code. This launch sends no automatic emails; share approval through your normal business onboarding process.

Bronze 3%, Silver 4%, Gold 5%, Platinum 6%. Draft qualification defaults are 0 / 5 / 15 / 30 completed, reconciled referred bookings. They are NOT active at launch. Review and activate through Tier rules in Admin. Until then, new confirmations use Bronze. Booking rates are snapshotted on confirmation and remain unchanged after settings edits.

## Attribution
- URL: `https://www.gozonyx.com/?ref=CODE`.
- First valid referral persists in that browser for 30 days; another code cannot overwrite it.
- Guests may apply a code in the booking form before paying. Storage-blocked browsers should contact support before payment.
- Attribution writes only partner tables; it does not change booking prices, payment authorization or agreements.
- One partner per booking. Locked after confirmation or 24 hours after creation, whichever is earlier.
- Admin may attach an active code within that same pending-booking window.
- Same-account/email and partner-hosted vehicle self-referrals are rejected.
- Suspended/rejected codes cannot create referrals. Existing records remain intact.
- This launch awards a booking once; renewal periods do not create duplicate or separate automatic commissions. No historical booking is backfilled, including ZNX-000150.

## Reconcile eligible revenue
A pending referral is not earned money. After return and completion:
1. Verify the LIVE rental payment and final settlement against Square/PayPal and bank reconciliation. Holds do not qualify.
2. Calculate eligible net rental revenue actually retained by ZONYX. Deduct discounts, refunds, chargebacks, host share and processing fees. Exclude taxes, deposits, refundable amounts, penalties, insurance pass-throughs and every other non-commissionable charge. Canceled, fraudulent or unpaid bookings earn zero.
3. Select the booking in Partners → Booking commissions. Enter eligible net revenue, final settlement timestamp, evidence reference and reconciliation notes. Explicitly attest both settlement and exclusions.
4. Backend requires a completed rental, a confirmed referral, a recorded LIVE paid rental payment and eligible net no greater than the rental subtotal less recorded refunds. Commission is `floor(net_cents × snapshotted_rate_bps / 10000)`.
5. Default reconciliation window: 14 days, editable 0–180 days. Payable time is after the later of return and settlement plus the snapshotted window. Changing settings does not change already verified windows.
6. A later change in booking/payment/refund-operation/financial-ledger source data withholds payout until reverified. Review disputes or chargebacks not yet synchronized into ZONYX directly with the provider before every payout.

## Manual payout and ledger
Check `payable`, partner status, available balance and current settlement evidence. Pay through the approved business banking process outside ZONYX. Only after transfer, record paid amount, reference and reason. This action records money sent; it does not send funds. Duplicate references and overpayments are rejected, including concurrent requests. Export the CSV ledger for accounting.

For refunds, reconcile again using corrected net revenue: a signed adjustment is appended. Reverse disqualified commissions. Prior paid entries remain intact; overpayments appear as a negative recovery balance. Handle recovery through normal billing operations. No automatic debit or commission payout is created.

## Privacy
Partner views contain reservation references, dates and commission progress, never renter names, contact details, licenses, cards or acceptance evidence. Direct table access is denied; narrowly scoped RPCs check partner ownership/admin status. Existing Admin authorization remains unchanged. Audit history records administrative actions.

## Recovery
Use `docs/partner-program-recovery.sql` after rolling back the frontend to the prior known-good deployment. It removes only the new observer and revokes partner write RPCs. It retains all records for repair, audit and recovery. Recovery was tested in isolated PostgreSQL and rolled back. Never drop partner tables or edit customer, payment or signed records to undo this release.

## Print assets
Two-page front/back print PDF: 3.5 × 2 inch trim, 0.125 inch bleed per side, crop marks outside bleed, embedded official logo. Digital PDF/PNGs have no marks. QR decodes to https://www.gozonyx.com/partners from both rendered PDF backs. No commission amounts or percentages appear on the cards. Ask the printer for its preferred color-profile conversion and physical proof before a large run.
