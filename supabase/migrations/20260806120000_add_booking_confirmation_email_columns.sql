ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS confirmation_email_sent_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS confirmation_email_provider_id text NULL;
