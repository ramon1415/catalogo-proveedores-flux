-- Commit the enum extension before functions/constraints use the new value.
alter type public.payment_request_type add value if not exists 'convenio';
