-- Module 1C — Cancellation + Refund lifecycle
-- ZONYX policy:
--   * Guest cancellation of own confirmed/pending_payment booking
--     → refund everything EXCEPT the non-refundable service_fee_cents
--   * Host/provider cancellation (host cannot provide the vehicle)
--     → FULL refund of all amounts paid (rental + service fees + taxes)
--   * Server-side eligibility enforced; active/pending_inspection/completed rejected
--   * If an uncaptured authorization hold exists when an eligible booking is cancelled,
--     release it. NEVER capture because of cancellation.
--   * Stripe refund targets the original PaymentIntent; never a compensating/new payment.

ALTER TABLE IF EXISTS public.bookings
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_actor_role text,
  ADD COLUMN IF NOT EXISTS cancel_actor_profile_id uuid,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS cancel_type text,
  ADD COLUMN IF NOT EXISTS stripe_refund_id text,
  ADD COLUMN IF NOT EXISTS refund_amount_cents integer,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;

ALTER TABLE IF EXISTS public.bookings
  ADD CONSTRAINT cancel_actor_role_chk
    CHECK (cancel_actor_role IS NULL OR cancel_actor_role IN ('guest', 'host', 'admin')),
  ADD CONSTRAINT cancel_type_chk
    CHECK (cancel_type IS NULL OR cancel_type IN ('guest', 'host_provider'));

CREATE OR REPLACE FUNCTION public.plan_booking_cancellation(
  _booking_id           uuid,
  _actor_role           text,
  _actor_profile_id     uuid,
  _cancel_type          text,
  _trip_status          text,
  _subtotal_cents       integer,
  _service_fee_cents    integer,
  _taxes_cents          integer,
  _grand_total_cents    integer,
  _has_refundable_payment boolean
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  IF _trip_status = 'cancelled' THEN
    result := json_build_object('eligible', false, 'reason', 'already_cancelled');
    RETURN result;
  END IF;
  IF _trip_status IN ('active', 'pending_inspection', 'completed') THEN
    result := json_build_object('eligible', false, 'reason', 'trip_in_progress');
    RETURN result;
  END IF;
  IF _cancel_type NOT IN ('guest', 'host_provider') THEN
    result := json_build_object('eligible', false, 'reason', 'invalid_cancel_type');
    RETURN result;
  END IF;
  IF _actor_role = 'guest' AND _cancel_type <> 'guest' THEN
    result := json_build_object('eligible', false, 'reason', 'guests_cancel_as_guest');
    RETURN result;
  END IF;

  IF _cancel_type = 'guest' THEN
    IF _has_refundable_payment AND _grand_total_cents <= 0 THEN
      result := json_build_object('eligible', false, 'reason', 'unverifiable_payment');
      RETURN result;
    END IF;
    IF _has_refundable_payment THEN
      result := json_build_object(
        'eligible', true,
        'refund_cents', GREATEST(0, _subtotal_cents + _taxes_cents),
        'release_deposit', true
      );
    ELSE
      result := json_build_object(
        'eligible', true,
        'refund_cents', 0,
        'release_deposit', true,
        'cancel_without_refund', true
      );
    END IF;
  ELSE
    result := json_build_object(
      'eligible', true,
      'refund_cents', _grand_total_cents,
      'release_deposit', true,
      'full_refund', true
    );
  END IF;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.persist_booking_cancellation(
  _booking_id         uuid,
  _cancel_type        text,
  _cancel_reason      text,
  _actor_role         text,
  _actor_profile_id   uuid,
  _stripe_refund_id   text,
  _refund_amount_cents integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_status text;
BEGIN
  SELECT trip_status INTO current_status
  FROM public.bookings WHERE id = _booking_id FOR UPDATE;

  IF current_status = 'cancelled' THEN
    RETURN false;
  END IF;
  IF current_status IN ('active', 'pending_inspection', 'completed') THEN
    RETURN false;
  END IF;

  UPDATE public.bookings
  SET trip_status = 'cancelled',
      cancelled_at = now(),
      cancel_type = _cancel_type,
      cancel_reason = _cancel_reason,
      cancel_actor_role = _actor_role,
      cancel_actor_profile_id = _actor_profile_id,
      stripe_refund_id = _stripe_refund_id,
      refund_amount_cents = _refund_amount_cents,
      updated_at = now()
  WHERE id = _booking_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.plan_booking_cancellation(
  uuid, text, uuid, text, text, integer, integer, integer, integer, boolean
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.persist_booking_cancellation(
  uuid, text, text, text, uuid, text, integer
) TO authenticated;
