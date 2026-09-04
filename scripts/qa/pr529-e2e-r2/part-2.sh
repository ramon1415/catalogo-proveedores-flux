 budget_checked_at,budget_result,is_extraordinary_adjustment,exception_status,
 request_number,payment_method,due_date,scheduled_payment_date
) values (
 :'request_id'::uuid,:'company'::uuid,:'provider'::uuid,:'cost_center'::uuid,
 :'budget_category'::uuid,:'requester'::uuid,:'approver'::uuid,:'assignment_id'::uuid,
 'assigned',529.29,'MXN','QA PR529 E2E R2 - NO PAGAR',
 'Prueba controlada de correo de excepción y aprobación segura.',
 'QA temporal; borrar automáticamente al finalizar.',
 'submitted'::public.payment_request_status,now(),date_trunc('month',current_date)::date,
 'bloqueado','QA: faltante presupuestal controlado para PR #529',0,-529.29,529.29,
 now(),jsonb_build_object('qa',true,'pr',529,'run',:'request_number'),false,'pending',
 :'request_number','transfer',current_date+7,current_date+7
);
update public.notification_events
set priority='critical',
    subject='QA PR529 excepción — '||:'request_number',
    next_attempt_at=now()+interval '30 minutes',
    payload=payload||jsonb_build_object('qa_pr529',true,'qa_run',:'request_number')
where event_type='payment_request.created'
  and source_table='payment_requests'
  and source_id=:'request_id'::uuid;
commit;
SQL
psql "$SUPABASE_DEV_DB_URL" --no-psqlrc -v ON_ERROR_STOP=1 \
  -v role_id="$QA_ROLE_ROW_ID" -v director_id="$QA_DIRECTOR_ROW_ID" \
  -v assignment_id="$QA_ASSIGNMENT_ROW_ID" -v request_id="$QA_REQUEST_ID" \
  -v request_number="$QA_REQUEST_NUMBER" -v approver="$QA_APPROVER_PROFILE_ID" \
  -v requester="$QA_REQUESTER_PROFILE_ID" -v director_role="$DIRECTOR_ROLE_ID" \
  -v company="$OPERADORA_COMPANY_ID" -v provider="$QA_PROVIDER_ID" \
  -v cost_center="$QA_COST_CENTER_ID" -v budget_category="$QA_BUDGET_CATEGORY_ID" \
  -f "$PRIVATE_DIR/create.sql" > "$EVIDENCE_DIR/create-database.log"
QA_DATA_CREATED=1

EVENT_ROW="$(psql "$SUPABASE_DEV_DB_URL" --no-psqlrc -AtX -F '|' -v ON_ERROR_STOP=1 \
  -v request_id="$QA_REQUEST_ID" -v request_number="$QA_REQUEST_NUMBER" \
  -v approver="$QA_APPROVER_PROFILE_ID" -v approver_email="$QA_APPROVER_EMAIL" <<'SQL'
select concat_ws('|',e.id::text,e.status,e.priority,e.recipient_profile_id::text,
 e.recipient_email,e.audience,e.payload->>'budget_decision',e.payload->>'budget_shortfall',
 to_char((e.created_at-interval '1 microsecond') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
from public.notification_events e
where e.event_type='payment_request.created'
  and e.source_table='payment_requests'
  and e.source_id=:'request_id'::uuid
  and e.source_folio=:'request_number'
  and e.recipient_profile_id=:'approver'::uuid
  and lower(btrim(e.recipient_email))=lower(:'approver_email');
SQL
)"
IFS='|' read -r QA_EVENT_ID EVENT_STATUS EVENT_PRIORITY RECIPIENT_ID RECIPIENT_EMAIL AUDIENCE BUDGET_DECISION BUDGET_SHORTFALL DISPATCH_CUTOFF <<< "$EVENT_ROW"
test -n "$QA_EVENT_ID"
test "$EVENT_STATUS" = pending
test "$EVENT_PRIORITY" = critical
test "$RECIPIENT_ID" = "$QA_APPROVER_PROFILE_ID"
test "$RECIPIENT_EMAIL" = "$QA_APPROVER_EMAIL"
test "$AUDIENCE" = internal
test "$BUDGET_DECISION" = bloqueado
test "$BUDGET_SHORTFALL" = 529.29

# Make only this exact QA event due, assert uniqueness, then invoke dispatcher.
psql "$SUPABASE_DEV_DB_URL" --no-psqlrc -v ON_ERROR_STOP=1 -v event="$QA_EVENT_ID" <<'SQL' > /dev/null
update public.notification_events
set status='pending', next_attempt_at=now(), locked_at=null, locked_by=null
where id=:'event'::uuid;
SQL
DUE_COUNT="$(psql "$SUPABASE_DEV_DB_URL" --no-psqlrc -AtX -v ON_ERROR_STOP=1 \
  -v cutoff="$DISPATCH_CUTOFF" <<'SQL'
select count(*)
from public.notification_events e
where e.event_type='payment_request.created'
  and e.status in ('pending','failed')
  and e.created_at>:'cutoff'::timestamptz
  and coalesce(e.next_attempt_at,now())<=now()
  and e.attempt_count<e.max_attempts
  and e.priority='critical';
SQL
)"
test "$DUE_COUNT" = 1
{
  echo "request_number=$QA_REQUEST_NUMBER"
  echo "request_id=$QA_REQUEST_ID"
  echo "event_id=$QA_EVENT_ID"
  echo "requester=$QA_REQUESTER_EMAIL"
  echo "approver_and_recipient=$QA_APPROVER_EMAIL"
  echo "amount=529.29 MXN"
  echo "due_critical_events_in_scope=1"
} > "$EVIDENCE_DIR/qa-data.txt"

dispatcher_url="https://$DEV_PROJECT_REF.supabase.co/functions/v1/$DISPATCHER_FUNCTION"
dispatch_body="$(jq -cn --arg cutoff "$DISPATCH_CUTOFF" '{limit:1,event_types:["payment_request.created"],created_at_from:$cutoff}')"
DISPATCH_CODE="$(curl --silent --show-error --max-time 60 \
  --output "$PRIVATE_DIR/dispatch.json" --write-out '%{http_code}' \
  --request POST "$dispatcher_url" --header 'Content-Type: application/json' \
  --header "x-notification-dispatcher-secret: $NOTIFICATION_DISPATCHER_SECRET" \
  --data "$dispatch_body")"
test "$DISPATCH_CODE" = 200
jq -e --arg event "$QA_EVENT_ID" --arg folio "$QA_REQUEST_NUMBER" --arg recipient "$QA_APPROVER_EMAIL" '
 .processed==1 and .sent==1 and .failed==0 and .mode=="test_only" and
 (.events|length)==1 and .events[0].event_id==$event and
 .events[0].source_folio==$folio and .events[0].status=="sent" and
 .events[0].intended_recipient_email==$recipient and
 .events[0].final_recipient_email==$recipient and
 (.events[0].provider_message_id|type=="string" and length>0)
' "$PRIVATE_DIR/dispatch.json" >/dev/null
jq '{processed,sent,failed,skipped,mode,events:[.events[]|{event_id,event_type,source_folio,status,
 provider_message_id_present:(.provider_message_id|type=="string" and length>0),
 intended_recipient_email,final_recipient_email}]}' "$PRIVATE_DIR/dispatch.json" > "$EVIDENCE_DIR/dispatcher-response.json"

DELIVERY="$(psql "$SUPABASE_DEV_DB_URL" --no-psqlrc -AtX -F '|' -v ON_ERROR_STOP=1 -v event="$QA_EVENT_ID" <<'SQL'
select concat_ws('|',e.status,e.processed_at is not null,count(a.id),
 bool_and(a.status='sent'),bool_and(nullif(btrim(a.provider_message_id),'') is not null))
from public.notification_events e
left join public.notification_delivery_attempts a on a.notification_event_id=e.id
where e.id=:'event'::uuid
group by e.id,e.status,e.processed_at;
SQL
)"
test "$DELIVERY" = "processed|t|1|t|t"
{
  echo "dispatcher_http=200"
  echo "processed=1"
  echo "sent=1"
  echo "failed=0"
  echo "mode=test_only"
  echo "delivery_attempts=1"
  echo "recipient=$QA_APPROVER_EMAIL"
  echo "cesar_recipient=no"
} > "$EVIDENCE_DIR/delivery.txt"

# Build valid, expired and tampered signed tokens from the actual QA event.
psql "$SUPABASE_DEV_DB_URL" --no-psqlrc -AtX -v ON_ERROR_STOP=1 \
  -v event="$QA_EVENT_ID" -v request="$QA_REQUEST_ID" <<'SQL' > "$PRIVATE_DIR/material.json"
select json_build_object(
 'notification_event_id',e.id::text,
 'payment_request_id',r.id::text,
 'approver_profile_id',r.approver_id::text,
 'submitted_at',r.submitted_at::text,
 'snapshot_hash',public.payment_request_exception_quick_snapshot(r.id),
 'expires_at',(e.created_at+interval '1 hour')::text,
 'expired_at',(now()-interval '1 minute')::text,
 'jti',encode(extensions.digest(convert_to(
   'payment-request-exception-quick-v1|'||e.id::text||'|'||r.id::text||'|'||
   r.approver_id::text||'|'||e.created_at::text,'UTF8'),'sha256'),'hex')
)::text
from public.notification_events e
join public.payment_requests r on r.id=e.source_id
where e.id=:'event'::uuid and r.id=:'request'::uuid;
SQL
chmod 600 "$PRIVATE_DIR/material.json"
DEV_PROJECT_REF="$DEV_PROJECT_REF" SECRET_FILE="$PRIVATE_DIR/secret" MATERIAL_FILE="$PRIVATE_DIR/material.json" OUT_DIR="$PRIVATE_DIR" node <<'NODE'
const fs = require('node:fs');
