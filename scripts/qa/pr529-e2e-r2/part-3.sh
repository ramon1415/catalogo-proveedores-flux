const crypto = require('node:crypto');
const source = JSON.parse(fs.readFileSync(process.env.MATERIAL_FILE, 'utf8'));
const secret = fs.readFileSync(process.env.SECRET_FILE, 'utf8');
function sign(expiresAt) {
  const payload = {
    version: 1,
    project_ref: process.env.DEV_PROJECT_REF,
    notification_event_id: source.notification_event_id,
    payment_request_id: source.payment_request_id,
    approver_profile_id: source.approver_profile_id,
    submitted_at: source.submitted_at,
    snapshot_hash: source.snapshot_hash,
    expires_at: expiresAt,
    jti: source.jti,
  };
  const segment = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(segment).digest('base64url');
  return `${segment}.${signature}`;
}
const valid = sign(source.expires_at);
const expired = sign(source.expired_at);
const [payloadSegment, signature] = valid.split('.');
const replacement = signature.startsWith('A') ? 'B' : 'A';
const tampered = `${payloadSegment}.${replacement}${signature.slice(1)}`;
fs.writeFileSync(`${process.env.OUT_DIR}/valid.token`, valid, {mode: 0o600});
fs.writeFileSync(`${process.env.OUT_DIR}/expired.token`, expired, {mode: 0o600});
fs.writeFileSync(`${process.env.OUT_DIR}/tampered.token`, tampered, {mode: 0o600});
NODE
for token_file in "$PRIVATE_DIR"/*.token; do echo "::add-mask::$(cat "$token_file")"; done
QUICK_URL="https://$DEV_PROJECT_REF.supabase.co/functions/v1/$QUICK_FUNCTION"

edge_call() {
  local action="$1" origin="$2" token_file="$3" out="$4" headers="$5"
  local token body
  token="$(cat "$token_file")"
  body="$(jq -cn --arg action "$action" --arg token "$token" '{action:$action,token:$token}')"
  curl --silent --show-error --max-time 45 --dump-header "$headers" \
    --output "$out" --write-out '%{http_code}' --request POST "$QUICK_URL" \
    --header 'Content-Type: application/json' --header "Origin: $origin" --data "$body"
}

# Valid preview and CORS.
PREVIEW_CODE="$(edge_call preview "$PREVIEW_ORIGIN" "$PRIVATE_DIR/valid.token" "$PRIVATE_DIR/preview.json" "$PRIVATE_DIR/preview.headers")"
test "$PREVIEW_CODE" = 200
jq -e --arg folio "$QA_REQUEST_NUMBER" '.state=="ready" and .folio==$folio and (.amount|tonumber)==529.29 and .budget_decision=="bloqueado"' "$PRIVATE_DIR/preview.json" >/dev/null
grep -i -F "access-control-allow-origin: $PREVIEW_ORIGIN" "$PRIVATE_DIR/preview.headers" >/dev/null
jq '{state,folio,provider,company,amount,currency,cost_center,budget_category,requester,budget_decision,budget_shortfall}' "$PRIVATE_DIR/preview.json" > "$EVIDENCE_DIR/preview-ready.json"

# Tampered signature and unauthorized origin.
TAMPER_CODE="$(edge_call preview "$PREVIEW_ORIGIN" "$PRIVATE_DIR/tampered.token" "$PRIVATE_DIR/tampered.json" "$PRIVATE_DIR/tampered.headers")"
test "$TAMPER_CODE" = 401
jq -e '.state=="invalid"' "$PRIVATE_DIR/tampered.json" >/dev/null
WRONG_ORIGIN_CODE="$(edge_call preview 'https://not-authorized.example.test' "$PRIVATE_DIR/valid.token" "$PRIVATE_DIR/wrong-origin.json" "$PRIVATE_DIR/wrong-origin.headers")"
test "$WRONG_ORIGIN_CODE" = 403
jq -e '.state=="invalid"' "$PRIVATE_DIR/wrong-origin.json" >/dev/null
! grep -qi '^access-control-allow-origin:' "$PRIVATE_DIR/wrong-origin.headers"

# Expired token is correctly signed but refused as expired.
EXPIRED_CODE="$(edge_call preview "$PREVIEW_ORIGIN" "$PRIVATE_DIR/expired.token" "$PRIVATE_DIR/expired.json" "$PRIVATE_DIR/expired.headers")"
test "$EXPIRED_CODE" = 200
jq -e '.state=="expired"' "$PRIVATE_DIR/expired.json" >/dev/null

# Snapshot invalidation: amount, then budget category, then exact restoration.
psql "$SUPABASE_DEV_DB_URL" --no-psqlrc -v ON_ERROR_STOP=1 -v request="$QA_REQUEST_ID" <<'SQL' > /dev/null
update public.payment_requests set amount_requested=530.29 where id=:'request'::uuid;
SQL
AMOUNT_CHANGED_CODE="$(edge_call preview "$PREVIEW_ORIGIN" "$PRIVATE_DIR/valid.token" "$PRIVATE_DIR/amount-changed.json" "$PRIVATE_DIR/amount-changed.headers")"
test "$AMOUNT_CHANGED_CODE" = 200
jq -e '.state=="changed"' "$PRIVATE_DIR/amount-changed.json" >/dev/null
psql "$SUPABASE_DEV_DB_URL" --no-psqlrc -v ON_ERROR_STOP=1 -v request="$QA_REQUEST_ID" <<'SQL' > /dev/null
update public.payment_requests set amount_requested=529.29 where id=:'request'::uuid;
SQL
RESTORED_AMOUNT_CODE="$(edge_call preview "$PREVIEW_ORIGIN" "$PRIVATE_DIR/valid.token" "$PRIVATE_DIR/restored-amount.json" "$PRIVATE_DIR/restored-amount.headers")"
test "$RESTORED_AMOUNT_CODE" = 200
jq -e '.state=="ready"' "$PRIVATE_DIR/restored-amount.json" >/dev/null

ALT_CATEGORY_ID="$(psql "$SUPABASE_DEV_DB_URL" --no-psqlrc -AtX -v ON_ERROR_STOP=1 -v original="$QA_BUDGET_CATEGORY_ID" <<'SQL'
select id::text from public.budget_categories where id<>:'original'::uuid order by id limit 1;
SQL
)"
test -n "$ALT_CATEGORY_ID"
psql "$SUPABASE_DEV_DB_URL" --no-psqlrc -v ON_ERROR_STOP=1 -v request="$QA_REQUEST_ID" -v category="$ALT_CATEGORY_ID" <<'SQL' > /dev/null
update public.payment_requests set budget_category_id=:'category'::uuid where id=:'request'::uuid;
SQL
CATEGORY_CHANGED_CODE="$(edge_call preview "$PREVIEW_ORIGIN" "$PRIVATE_DIR/valid.token" "$PRIVATE_DIR/category-changed.json" "$PRIVATE_DIR/category-changed.headers")"
test "$CATEGORY_CHANGED_CODE" = 200
jq -e '.state=="changed"' "$PRIVATE_DIR/category-changed.json" >/dev/null
psql "$SUPABASE_DEV_DB_URL" --no-psqlrc -v ON_ERROR_STOP=1 -v request="$QA_REQUEST_ID" -v category="$QA_BUDGET_CATEGORY_ID" <<'SQL' > /dev/null
update public.payment_requests set budget_category_id=:'category'::uuid where id=:'request'::uuid;
SQL
RESTORED_CATEGORY_CODE="$(edge_call preview "$PREVIEW_ORIGIN" "$PRIVATE_DIR/valid.token" "$PRIVATE_DIR/restored-category.json" "$PRIVATE_DIR/restored-category.headers")"
test "$RESTORED_CATEGORY_CODE" = 200
jq -e '.state=="ready"' "$PRIVATE_DIR/restored-category.json" >/dev/null

# Approval and idempotent anti-replay.
APPROVE_CODE="$(edge_call approve "$PREVIEW_ORIGIN" "$PRIVATE_DIR/valid.token" "$PRIVATE_DIR/approve.json" "$PRIVATE_DIR/approve.headers")"
test "$APPROVE_CODE" = 200
jq -e '.state=="approved" and .status=="approved"' "$PRIVATE_DIR/approve.json" >/dev/null
REPLAY_CODE="$(edge_call approve "$PREVIEW_ORIGIN" "$PRIVATE_DIR/valid.token" "$PRIVATE_DIR/replay.json" "$PRIVATE_DIR/replay.headers")"
test "$REPLAY_CODE" = 200
jq -e '.state=="already_approved"' "$PRIVATE_DIR/replay.json" >/dev/null
POST_CODE="$(edge_call preview "$PREVIEW_ORIGIN" "$PRIVATE_DIR/valid.token" "$PRIVATE_DIR/post-preview.json" "$PRIVATE_DIR/post-preview.headers")"
test "$POST_CODE" = 200
jq -e '.state=="already_approved"' "$PRIVATE_DIR/post-preview.json" >/dev/null

DB_RESULT="$(psql "$SUPABASE_DEV_DB_URL" --no-psqlrc -AtX -F '|' -v ON_ERROR_STOP=1 \
  -v request="$QA_REQUEST_ID" -v event="$QA_EVENT_ID" -v approver="$QA_APPROVER_PROFILE_ID" <<'SQL'
select concat_ws('|',r.status::text,r.exception_status,r.exception_approved_by::text,
 (select count(*) from public.payment_request_approvals a where a.payment_request_id=r.id and a.action='exception_approved'),
 (select count(*) from public.payment_request_exception_quick_approval_uses l
   where l.payment_request_id=r.id and l.notification_event_id=:'event'::uuid
     and l.outcome='approved' and l.used_at is not null),
 (r.exception_approved_by=:'approver'::uuid))
from public.payment_requests r where r.id=:'request'::uuid;
SQL
)"
test "$DB_RESULT" = "approved|approved|$QA_APPROVER_PROFILE_ID|1|1|t"

# Kill switch must revoke the already-issued, still-valid token.
echo 'PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_ENABLED=false' > "$PRIVATE_DIR/flag-off.env"
supabase secrets set --project-ref "$DEV_PROJECT_REF" --env-file "$PRIVATE_DIR/flag-off.env" > "$EVIDENCE_DIR/kill-switch-set.txt"
KILL_CONFIRMED=0
for attempt in $(seq 1 20); do
  KILL_CODE="$(edge_call preview "$PREVIEW_ORIGIN" "$PRIVATE_DIR/valid.token" "$PRIVATE_DIR/kill.json" "$PRIVATE_DIR/kill.headers")"
  if [ "$KILL_CODE" = 400 ] && jq -e '.state=="invalid"' "$PRIVATE_DIR/kill.json" >/dev/null; then
    KILL_CONFIRMED=1
    break
  fi
  sleep 3
done
test "$KILL_CONFIRMED" = 1

{
  echo "preview_ready=pass"
  echo "tampered_signature=401_invalid"
  echo "unauthorized_origin=403_invalid"
  echo "expired_token=expired"
  echo "amount_snapshot_change=changed"
  echo "budget_category_snapshot_change=changed"
  echo "snapshot_restoration=ready"
  echo "first_approval=approved"
  echo "second_use=already_approved"
  echo "approval_rows=1"
  echo "anti_replay_rows=1"
  echo "kill_switch=valid_token_blocked"
} > "$EVIDENCE_DIR/security-and-approval.txt"
jq '{state,status}' "$PRIVATE_DIR/approve.json" > "$EVIDENCE_DIR/approve.json"
jq '{state}' "$PRIVATE_DIR/replay.json" > "$EVIDENCE_DIR/replay.json"
jq '{state}' "$PRIVATE_DIR/expired.json" > "$EVIDENCE_DIR/expired.json"
jq '{state}' "$PRIVATE_DIR/amount-changed.json" > "$EVIDENCE_DIR/amount-changed.json"
