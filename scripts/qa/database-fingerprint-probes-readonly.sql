BEGIN TRANSACTION READ ONLY;
SELECT jsonb_build_object(
 'captured_at', current_timestamp,
 'project_ref', 'scsirgbuqjcwoaxfacth',
 'read_only', current_setting('transaction_read_only'),
 'fingerprint_probes', (SELECT jsonb_object_agg(label, public.provider_intake_action_fingerprint(2,kind,'11111111-1111-4111-8111-111111111111'::uuid,actor::uuid,status,stamp::timestamptz,target,notes)) FROM (VALUES
 ('base','transition','22222222-2222-4222-8222-222222222222','received','2026-01-01T12:34:56.123Z','in_review','Nota QA'),
 ('trim','transition','22222222-2222-4222-8222-222222222222','received','2026-01-01T12:34:56.123Z','in_review','  Nota QA  '),
 ('timezone','transition','22222222-2222-4222-8222-222222222222','received','2026-01-01T06:34:56.123-06:00','in_review','Nota QA'),
 ('actor','transition','33333333-3333-4333-8333-333333333333','received','2026-01-01T12:34:56.123Z','in_review','Nota QA'),
 ('status','transition','22222222-2222-4222-8222-222222222222','in_review','2026-01-01T12:34:56.123Z','in_review','Nota QA'),
 ('stamp','transition','22222222-2222-4222-8222-222222222222','received','2026-01-01T12:34:56.124Z','in_review','Nota QA'),
 ('target','transition','22222222-2222-4222-8222-222222222222','received','2026-01-01T12:34:56.123Z','rejected','Nota QA'),
 ('notes','transition','22222222-2222-4222-8222-222222222222','received','2026-01-01T12:34:56.123Z','in_review','Otra nota'),
 ('operation','internal_note','22222222-2222-4222-8222-222222222222','received','2026-01-01T12:34:56.123Z','in_review','Nota QA')
 ) AS probes(label,kind,actor,status,stamp,target,notes))
) AS catalog;
COMMIT;
