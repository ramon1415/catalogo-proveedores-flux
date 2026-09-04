        runtime_remaining=1
      fi
    done
    if [ "$final_state" = "0|0|0|0|0|0|0" ] && [ "$runtime_remaining" = 0 ]; then
      break
    fi
    sleep 2
  done
  echo "final_database_state=$final_state" >> "$EVIDENCE_DIR/cleanup.txt"
  echo "runtime_values_remaining=$runtime_remaining" >> "$EVIDENCE_DIR/cleanup.txt"
  if [ "$final_state" != "0|0|0|0|0|0|0" ] || [ "$runtime_remaining" != 0 ]; then
    CLEANUP_FAILED=1
  fi

  rm -rf "$PRIVATE_DIR"
  echo "private_files_removed=yes" >> "$EVIDENCE_DIR/cleanup.txt"
  echo "quick_approval_left_enabled=no" >> "$EVIDENCE_DIR/cleanup.txt"
  echo "main_touched=no" >> "$EVIDENCE_DIR/cleanup.txt"
  echo "prod_touched=no" >> "$EVIDENCE_DIR/cleanup.txt"
  echo "cesar_contacted=no" >> "$EVIDENCE_DIR/cleanup.txt"

  if [ "$CLEANUP_FAILED" -ne 0 ]; then
    echo "PR529_R2_CLEANUP_FAILED" >&2
    exit 1
  fi
  echo "PR529_R2_CLEANUP_PASS"
  exit "$original_rc"
}
trap cleanup EXIT

{
  echo "# PR #529 — DEV E2E certification R2"
  echo
  echo "- Run: $GITHUB_RUN_ID"
  echo "- QA branch commit: $GITHUB_SHA"
  echo "- Certified feature head: $FEATURE_HEAD"
  echo "- Supabase target: DEV only"
  echo "- QA requester: $QA_REQUESTER_EMAIL"
  echo "- QA approver and recipient: $QA_APPROVER_EMAIL"
  echo "- Request number: $QA_REQUEST_NUMBER"
  echo "- César contacted: no"
  echo "- main / PROD touched: no"
} > "$EVIDENCE_DIR/summary.md"

# Public confirmation page must be available from the feature preview.
static_ready=0
for attempt in $(seq 1 60); do
  if curl --fail --location --silent --show-error --max-time 20 \
      "$PREVIEW_ORIGIN/payment_request_exception_quick_approve.html" \
      > "$PRIVATE_DIR/page.html" 2>/dev/null && \
     curl --fail --location --silent --show-error --max-time 20 \
      "$PREVIEW_ORIGIN/payment_request_exception_quick_approve.js" \
      > "$PRIVATE_DIR/page.js" 2>/dev/null && \
     grep -q 'payment_request_exception_quick_approve.js' "$PRIVATE_DIR/page.html" && \
     grep -q 'endpointFromToken' "$PRIVATE_DIR/page.js"; then
    static_ready=1
    break
  fi
  sleep 5
done
test "$static_ready" = 1
{
  echo "public_page=reachable"
  echo "public_js=reachable"
  echo "endpoint_from_signed_project_ref=yes"
} > "$EVIDENCE_DIR/static-page.txt"

# Fail closed if any prior QA state or quick-approval runtime value exists.
initial_state="$(verify_clean_database)"
test "$initial_state" = "0|0|0|0|0|0|0"
echo "database_and_runtime_preflight=clean" > "$EVIDENCE_DIR/preflight.txt"

curl --fail --silent --show-error \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$DEV_PROJECT_REF/functions/$DISPATCHER_FUNCTION" \
  > "$PRIVATE_DIR/dispatcher-before.json"
curl --fail --silent --show-error \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$DEV_PROJECT_REF/functions/$QUICK_FUNCTION" \
  > "$PRIVATE_DIR/quick-before.json"
DISPATCHER_BEFORE_VERSION="$(jq -er '.version' "$PRIVATE_DIR/dispatcher-before.json")"
DISPATCHER_BEFORE_HASH="$(jq -er '.ezbr_sha256' "$PRIVATE_DIR/dispatcher-before.json")"
QUICK_BEFORE_VERSION="$(jq -er '.version' "$PRIVATE_DIR/quick-before.json")"
test "$(jq -r '.status' "$PRIVATE_DIR/dispatcher-before.json")" = ACTIVE
test "$(jq -r '.status' "$PRIVATE_DIR/quick-before.json")" = ACTIVE
jq '{slug,status,version,verify_jwt,ezbr_sha256}' "$PRIVATE_DIR/dispatcher-before.json" > "$EVIDENCE_DIR/dispatcher-before.json"
jq '{slug,status,version,verify_jwt,ezbr_sha256}' "$PRIVATE_DIR/quick-before.json" > "$EVIDENCE_DIR/quick-before.json"

# Temporary environment configuration for this one controlled QA email.
quick_secret="$(openssl rand -hex 32)"
echo "::add-mask::$quick_secret"
printf '%s' "$quick_secret" > "$PRIVATE_DIR/secret"
chmod 600 "$PRIVATE_DIR/secret"
cat > "$PRIVATE_DIR/runtime.env" <<EOF_RUNTIME
PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_SECRET=$quick_secret
PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_ENABLED=true
PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_BASE_URL=$PREVIEW_ORIGIN
PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_ALLOWED_ORIGIN=$PREVIEW_ORIGIN
PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_TTL_HOURS=1
EOF_RUNTIME
chmod 600 "$PRIVATE_DIR/runtime.env"
SECRETS_SET=1
supabase secrets set --project-ref "$DEV_PROJECT_REF" --env-file "$PRIVATE_DIR/runtime.env" > "$EVIDENCE_DIR/secrets-set.txt"
rm -f "$PRIVATE_DIR/runtime.env"

# Deploy only the dedicated quick edge. The dispatcher remains untouched.
supabase functions deploy "$QUICK_FUNCTION" --project-ref "$DEV_PROJECT_REF" --no-verify-jwt \
  > "$EVIDENCE_DIR/quick-deploy-stdout.txt" 2> "$EVIDENCE_DIR/quick-deploy-stderr.txt"
sleep 8
curl --fail --silent --show-error \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$DEV_PROJECT_REF/functions/$DISPATCHER_FUNCTION" \
  > "$PRIVATE_DIR/dispatcher-after.json"
curl --fail --silent --show-error \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$DEV_PROJECT_REF/functions/$QUICK_FUNCTION" \
  > "$PRIVATE_DIR/quick-after.json"
DISPATCHER_AFTER_VERSION="$(jq -er '.version' "$PRIVATE_DIR/dispatcher-after.json")"
DISPATCHER_AFTER_HASH="$(jq -er '.ezbr_sha256' "$PRIVATE_DIR/dispatcher-after.json")"
QUICK_AFTER_VERSION="$(jq -er '.version' "$PRIVATE_DIR/quick-after.json")"
test "$DISPATCHER_AFTER_VERSION" = "$DISPATCHER_BEFORE_VERSION"
test "$DISPATCHER_AFTER_HASH" = "$DISPATCHER_BEFORE_HASH"
test "$QUICK_AFTER_VERSION" -ge "$QUICK_BEFORE_VERSION"
test "$(jq -r '.status' "$PRIVATE_DIR/quick-after.json")" = ACTIVE
jq '{slug,status,version,verify_jwt,ezbr_sha256}' "$PRIVATE_DIR/dispatcher-after.json" > "$EVIDENCE_DIR/dispatcher-after.json"
jq '{slug,status,version,verify_jwt,ezbr_sha256}' "$PRIVATE_DIR/quick-after.json" > "$EVIDENCE_DIR/quick-after.json"
{
  echo "deployed_function=$QUICK_FUNCTION"
  echo "notification_dispatcher_redeployed=no"
  echo "notification_dispatcher_unchanged=yes"
  echo "quick_version_before=$QUICK_BEFORE_VERSION"
  echo "quick_version_after=$QUICK_AFTER_VERSION"
  echo "prod_touched=no"
} > "$EVIDENCE_DIR/deployment-boundary.txt"

# Create one isolated exception request and postpone its notification so the
# background dispatcher cannot race this certification before the manual claim.
cat > "$PRIVATE_DIR/create.sql" <<'SQL'
begin;
insert into public.user_roles (id,profile_id,role_id)
values (:'role_id'::uuid,:'approver'::uuid,:'director_role'::uuid);
insert into public.company_directors (id,company_id,director_profile_id,active,created_by)
values (:'director_id'::uuid,:'company'::uuid,:'approver'::uuid,true,:'approver'::uuid);
insert into public.approver_assignments (id,company_id,requester_id,approver_id,active,created_by)
values (:'assignment_id'::uuid,:'company'::uuid,:'requester'::uuid,:'approver'::uuid,true,:'approver'::uuid);
insert into public.payment_requests (
 id,company_id,proveedor_id,cost_center_id,budget_category_id,requested_by,
 approver_id,approver_assignment_id,approver_selection_source,amount_requested,
 currency,concept,description,notes,status,submitted_at,budget_month,budget_decision,
 budget_block_reason,budget_available_before,budget_available_after,budget_shortfall,
