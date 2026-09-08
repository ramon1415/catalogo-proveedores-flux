# Payroll notification worker

Deploy this function explicitly with `verify_jwt=false` (MCP deployment setting)
or `supabase functions deploy payroll-notification-dispatcher --no-verify-jwt`.
The handler authenticates every request using `x-notification-dispatcher-secret`
against the existing `NOTIFICATION_DISPATCHER_SECRET`. Client access is denied.
The shared root configuration is not part of this payroll release.

Required existing project secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`NOTIFICATION_DISPATCHER_SECRET`, `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL`.
Delivery obeys `NOTIFICATION_SEND_MODE`: disabled, test_only or real.
test_only additionally requires `NOTIFICATION_TEST_EMAIL`; it always redirects
payroll email there. Requests cannot supply recipients or override the mode.

The service-only claim RPC additionally requires the company's
`payroll_notification_settings.dispatch_enabled`. This is false in DEV until an
authorized delivery test. A cron wakeup uses the existing Vault dispatcher URL
and secret, changing only the final function slug.

Review the project reference and recipient/mode before activating delivery.
Never smoke-test by closing a real unpaid payroll. Use local mocked transports
or an explicitly authorized test run and recipient. See the payroll pilot QA
record for deployment versions, checks and remaining authenticated UAT.
