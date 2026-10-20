-- Emergency isolation only. Does not delete records or alter booking/payment data.
-- First promote the previous known-good frontend deployment in Vercel.
BEGIN;
DROP TRIGGER IF EXISTS partner_snapshot_after_confirmation ON public.bookings;
REVOKE EXECUTE ON FUNCTION public.apply_partner(text,text,text,text,text),public.attach_partner_referral(uuid,text,text),public.admin_partner_action(text,uuid,jsonb) FROM authenticated;
COMMIT;
-- Retain all partner tables and ledger/audit records for review and recovery.
-- Re-enable only after a reviewed corrective migration; never edit historical ledger rows.
