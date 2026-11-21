-- REVIEW TEMPLATE ONLY — NOT A MIGRATION; NOT EXECUTED.
-- Requires approval, pg_cron, pg_net, Vault, deployed guest-account endpoint,
-- and these existing Vault entries populated securely by the release operator:
--   guest_account_worker_url: exact HTTPS /functions/v1/guest-account URL
--   guest_account_worker_secret: same server-only 32+ character worker secret
--   guest_account_publishable_key: registered project publishable key
-- Never put secret values in this file or frontend environment variables.

SELECT cron.schedule('zonyx-guest-account-invitations', '* * * * *', $job$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='guest_account_worker_url'),
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='guest_account_publishable_key'),
      'Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='guest_account_worker_secret')
    ),
    body := '{"action":"deliver-invitations"}'::jsonb,
    timeout_milliseconds := 55000
  );
$job$);

-- Monitor cron.job_run_details, net._http_response, and exhausted mail jobs:
-- SELECT booking_id,attempts,next_attempt_at FROM guest_checkout_private.invitations
-- WHERE sent_at IS NULL AND attempts>=8;
-- Also monitor guest_checkout_private.confirmation_jobs for sent_at IS NULL AND attempts>=8.
-- Monitor guest-contact confirmed bookings without invitations if the worker
-- has been unavailable. Do not replay payment actions to repair an email job.
