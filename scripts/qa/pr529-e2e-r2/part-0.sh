#!/usr/bin/env bash
set -Eeuo pipefail

EVIDENCE_DIR="${RUNNER_TEMP}/pr529-dev-e2e-r2-evidence"
PRIVATE_DIR="${RUNNER_TEMP}/pr529-dev-e2e-r2-private"
mkdir -p "$EVIDENCE_DIR" "$PRIVATE_DIR"
chmod 700 "$EVIDENCE_DIR" "$PRIVATE_DIR"

readarray -t QA_IDS < <(python3 - <<'PY'
import os, uuid
ns = uuid.UUID('687ebd52-7f65-4ebf-9d3b-589d79676560')
run = os.environ['GITHUB_RUN_ID']
for name in ('role', 'director', 'assignment', 'request'):
    print(uuid.uuid5(ns, f'{run}/{name}'))
PY
)
QA_ROLE_ROW_ID="${QA_IDS[0]}"
QA_DIRECTOR_ROW_ID="${QA_IDS[1]}"
QA_ASSIGNMENT_ROW_ID="${QA_IDS[2]}"
QA_REQUEST_ID="${QA_IDS[3]}"
QA_REQUEST_NUMBER="QA-PR529-R2-${GITHUB_RUN_ID}-NO-PAGAR"
SECRETS_SET=0
QA_DATA_CREATED=0
CLEANUP_FAILED=0

mask_runtime() {
  for value in "$SUPABASE_ACCESS_TOKEN" "$SUPABASE_DEV_DB_URL" "$NOTIFICATION_DISPATCHER_SECRET"; do
    echo "::add-mask::$value"
  done
}
mask_runtime

write_cleanup_sql() {
  cat > "$PRIVATE_DIR/cleanup.sql" <<'SQL'
begin;
delete from public.payment_request_exception_quick_approval_uses
 where payment_request_id=:'request_id'::uuid
    or notification_event_id in (
      select id from public.notification_events
      where source_id=:'request_id'::uuid or source_folio=:'request_number'
    );
delete from public.notification_delivery_attempts
 where notification_event_id in (
   select id from public.notification_events
   where source_id=:'request_id'::uuid or source_folio=:'request_number'
 );
delete from public.notification_events
 where source_id=:'request_id'::uuid or source_folio=:'request_number';
delete from public.payment_request_approvals where payment_request_id=:'request_id'::uuid;
delete from public.payment_request_extraordinary_events where payment_request_id=:'request_id'::uuid;
delete from public.payment_request_extraordinary_authorizations where payment_request_id=:'request_id'::uuid;
delete from public.payment_requests where id=:'request_id'::uuid or request_number=:'request_number';
delete from public.approver_assignments where id=:'assignment_id'::uuid;
delete from public.company_directors where id=:'director_id'::uuid;
delete from public.user_roles where id=:'role_id'::uuid;
commit;
SQL
}

verify_clean_database() {
  psql "$SUPABASE_DEV_DB_URL" --no-psqlrc -AtX -v ON_ERROR_STOP=1 \
    -v role_id="$QA_ROLE_ROW_ID" \
    -v director_id="$QA_DIRECTOR_ROW_ID" \
    -v assignment_id="$QA_ASSIGNMENT_ROW_ID" \
    -v request_id="$QA_REQUEST_ID" \
    -v request_number="$QA_REQUEST_NUMBER" <<'SQL'
select concat_ws('|',
  (select count(*) from public.user_roles where id=:'role_id'::uuid),
  (select count(*) from public.company_directors where id=:'director_id'::uuid),
  (select count(*) from public.approver_assignments where id=:'assignment_id'::uuid),
  (select count(*) from public.payment_requests where id=:'request_id'::uuid or request_number=:'request_number'),
  (select count(*) from public.notification_events where source_id=:'request_id'::uuid or source_folio=:'request_number'),
  (select count(*) from public.payment_request_exception_quick_approval_uses where payment_request_id=:'request_id'::uuid),
  (select count(*) from vault.decrypted_secrets where name like 'PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_%')
);
SQL
}

unset_runtime_values() {
  local help_file="$PRIVATE_DIR/secrets-unset-help.txt"
  supabase secrets unset --help > "$help_file" 2>&1
  local names=(
    PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_SECRET
    PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_ENABLED
    PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_BASE_URL
    PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_ALLOWED_ORIGIN
    PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_TTL_HOURS
  )
  if grep -q -- '--yes' "$help_file"; then
    supabase secrets unset "${names[@]}" --project-ref "$DEV_PROJECT_REF" --yes
  else
    printf 'y\n' | supabase secrets unset "${names[@]}" --project-ref "$DEV_PROJECT_REF"
  fi
}

cleanup() {
  local original_rc=$?
  trap - EXIT
  set +e
  echo "cleanup_started=yes" > "$EVIDENCE_DIR/cleanup.txt"

  if [ "$SECRETS_SET" = "1" ]; then
    local disable_file="$PRIVATE_DIR/disable.env"
    echo 'PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_ENABLED=false' > "$disable_file"
    chmod 600 "$disable_file"
    if supabase secrets set --project-ref "$DEV_PROJECT_REF" --env-file "$disable_file" >/dev/null 2>&1; then
      echo "disable_before_cleanup=pass" >> "$EVIDENCE_DIR/cleanup.txt"
    else
      CLEANUP_FAILED=1
      echo "disable_before_cleanup=failed" >> "$EVIDENCE_DIR/cleanup.txt"
    fi
  fi

  write_cleanup_sql
  if psql "$SUPABASE_DEV_DB_URL" --no-psqlrc -v ON_ERROR_STOP=1 \
      -v role_id="$QA_ROLE_ROW_ID" \
      -v director_id="$QA_DIRECTOR_ROW_ID" \
      -v assignment_id="$QA_ASSIGNMENT_ROW_ID" \
      -v request_id="$QA_REQUEST_ID" \
      -v request_number="$QA_REQUEST_NUMBER" \
      -f "$PRIVATE_DIR/cleanup.sql" > "$EVIDENCE_DIR/cleanup-database.log" 2>&1; then
    echo "database_cleanup=pass" >> "$EVIDENCE_DIR/cleanup.txt"
  else
    CLEANUP_FAILED=1
    echo "database_cleanup=failed" >> "$EVIDENCE_DIR/cleanup.txt"
  fi

  if [ "$SECRETS_SET" = "1" ]; then
    if unset_runtime_values > "$EVIDENCE_DIR/secrets-unset.txt" 2>&1; then
      echo "runtime_cleanup=pass" >> "$EVIDENCE_DIR/cleanup.txt"
    else
      CLEANUP_FAILED=1
      echo "runtime_cleanup=failed" >> "$EVIDENCE_DIR/cleanup.txt"
    fi
  fi

  local final_state="query_failed"
  local runtime_remaining=1
  for attempt in $(seq 1 20); do
    final_state="$(verify_clean_database 2>/dev/null || echo query_failed)"
    local secret_list
    secret_list="$(supabase secrets list --project-ref "$DEV_PROJECT_REF" 2>/dev/null || true)"
    runtime_remaining=0
    for name in \
      PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_SECRET \
      PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_ENABLED \
      PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_BASE_URL \
      PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_ALLOWED_ORIGIN \
      PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_TTL_HOURS; do
      if printf '%s\n' "$secret_list" | grep -Eq "(^|[[:space:]])${name}([[:space:]]|$)"; then
