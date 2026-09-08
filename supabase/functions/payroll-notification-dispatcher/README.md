# Payroll notification worker

Deploy this function explicitly with `verify_jwt=false` (MCP deployment setting)
or `supabase functions deploy payroll-notification-dispatcher --no-verify-jwt`.
The handler authenticates every request using `x-notification-dispatcher-secret`
against the existing `NOTIFICATION_DISPATCHER_SECRET`. Client access is denied.
The shared root configuration is not part of this payroll release.

Required existing project secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`NOTIFICATION_DISPATCHER_SECRET`, `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL`.
Delivery obeys `NOTIFICATION_SEND_MODE`: disabled, test_only or real.
test_only additionally requires `NOTIFICATION_TEST_EMAIL` as the default QA
recipient. An explicitly scoped QA run may use the active profile configured in
the service-only company settings. Requests cannot supply recipients or override
the mode. Scoped QA delivery is rejected in real mode.

An authenticated POST with `{"dry_run":true}` reports the effective mode,
test recipient (only in test_only), and whether required configuration exists.
It does not claim events, fetch files, call the email provider, or expose secrets.
Use this preflight before enabling a company's delivery setting.

To test one run, configure `test_capture_session_id`, `test_recipient_profile_id`
and `test_expires_at` together while delivery is disabled. Claims are limited to
that company's exact run until expiration. Expiration stops claims; it does not
fall back to normal delivery. Verify the profile email and global test_only mode,
then enable delivery. Disable delivery again after the two expected events.

The service-only claim RPC additionally requires the company's
`payroll_notification_settings.dispatch_enabled`. This is false in DEV until an
authorized delivery test. A cron wakeup uses the existing Vault dispatcher URL
and secret, changing only the final function slug.

Review the project reference and recipient/mode before activating delivery.
Never smoke-test by closing a real unpaid payroll. Use local mocked transports
or an explicitly authorized test run and recipient. See the payroll pilot QA
record for deployment versions, checks and remaining authenticated UAT.
