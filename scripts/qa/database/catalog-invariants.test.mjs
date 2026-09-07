import assert from 'node:assert/strict'
import test from 'node:test'
import { databaseCatalog, functionDefinition as fn, functionMetadata as metadata, assertRpcAccess } from '../database-catalog.mjs'
const catalog = databaseCatalog()
const find = (collection, name) => {
  const rows = catalog[collection].filter(x => x.name === name)
  assert.equal(rows.length, 1, `${collection}: ${name} must exist exactly once`)
  return rows[0]
}
const contains = (value, markers) => { for (const marker of markers) assert.ok(value.includes(marker), `Missing deployed invariant: ${marker}`) }

for (const name of [
  'payment_intake', 'intake_links', 'payment_intake_events', 'payment_intake_files',
  'payment_document_extractions', 'bank_payment_operations', 'payable_snapshots',
  'financial_command_receipts', 'financial_outbox_events', 'payment_extraction_corrections',
  'payment_operation_evidence', 'payment_request_receipt_links',
  'payment_request_extraordinary_authorizations', 'payment_request_extraordinary_events',
]) {
  test(`DEV RLS and direct write restrictions: ${name}`, () => {
    const table = find('tables', name)
    assert.equal(table.rls, true)
    assert.equal(table.anon_select, false)
    for (const action of ['insert', 'update', 'delete']) assert.equal(table[`authenticated_${action}`], false, `${name}: ${action}`)
  })
}
for (const name of [
  'transition_provider_intake', 'add_provider_intake_note', 'find_provider_intake_candidates',
  'get_provider_intake_match_comparison', 'set_provider_intake_match',
  'convert_provider_intake_to_payment_request', 'find_payment_receipt_candidates',
  'link_payment_receipt_to_request', 'prepare_payment_operation_evidence',
  'finalize_payment_operation_evidence', 'review_payment_operation_evidence',
  'complete_payment_request_layout_data', 'activate_extraordinary_authorization',
  'ratify_extraordinary_authorization', 'dispute_extraordinary_authorization',
  'extraordinary_evidence_storage_allowed', 'payment_receipt_evidence_storage_path_allowed',
]) test(`DEV RPC access and search_path: ${name}`, () => assertRpcAccess(name))
for (const name of [
  'provider_intake_action_fingerprint', 'provider_intake_match_fingerprint',
  'normalize_provider_match_text', 'normalize_provider_match_digits',
]) test(`DEV internal invoker helper is ungranted: ${name}`, () => assertRpcAccess(name, { authenticated: false, service: false, definer: false }))
for (const name of [
  'get_payment_receipt_notification_attachment', 'claim_notification_events_for_dispatcher_v2',
  'extraordinary_authorization_can_consume_layout_line', 'authorize_payment_request_extraordinary',
]) test(`DEV internal or legacy helper is not a browser RPC: ${name}`, () => assertRpcAccess(name, { authenticated: false }))

test('DEV matching RPCs cannot mutate financial authorities or change intake status', () => {
  for (const name of ['find_provider_intake_candidates', 'get_provider_intake_match_comparison', 'set_provider_intake_match']) {
    const source = metadata(name).body
    assert.doesNotMatch(source, /\b(?:insert\s+into|update|delete\s+from)\s+public\.(?:proveedores|payment_requests|approval_batches|payment_layouts|payment_layout_lines|notification_events)\b/i)
    assert.doesNotMatch(source, /update public\.payment_intake\s+set\s+status\b/i)
  }
})

for (const [name, fields] of [
  ['bank_payment_operations_fingerprint_key', ['operation_fingerprint']],
  ['bank_payment_operations_company_folio_key', ['company_id', 'bank_unique_folio']],
  ['financial_command_receipts_scope_key', ['company_id', 'command_scope', 'idempotency_key']],
  ['payment_request_receipt_links_request_key', ['payment_request_id']],
  ['payment_request_receipt_links_operation_key', ['operation_id']],
  ['payment_request_receipt_links_evidence_key', ['evidence_id']],
  ['payment_intake_events_action_id_uidx', ['payment_intake_id', 'action_id']],
  ['payment_request_extraordinary_authorizations_operational_uidx', ['payment_request_id', "'draft'", "'active'", "'consumed_pending_ratification'"]],
]) test(`DEV uniqueness guard: ${name}`, () => {
  const index = find('indexes', name)
  assert.equal(index.unique, true)
  assert.equal(index.valid, true)
  contains(index.definition, fields)
})

for (const [name, markers] of [
  ['payment_operation_evidence_pdf_check', ['application/pdf', 'page_count = 1', 'file_size_bytes']],
  ['payment_operation_evidence_attestation_check', ['shareable', 'single_operation_attested']],
  ['payment_operation_evidence_lifecycle_check', ['pending_upload', 'pending_review', 'shareable', 'not_shareable', 'reviewed_at', 'uploaded_at']],
  ['payment_request_extraordinary_status_check', ['draft', 'active', 'consumed_pending_ratification', 'ratified', 'revoked', 'disputed', 'legacy_quarantined']],
  ['payment_request_extraordinary_lifecycle_check', ['external_director_profile_id', 'valid_until > external_authorized_at', 'ratification_due_at > valid_until', 'idempotency_key', 'extraordinary-authorizations']],
  ['payment_request_extraordinary_legacy_class_check', ['legacy_consumed_unverified', 'legacy_quarantined', 'legacy_classified_at']],
  ['payment_request_extraordinary_revoke_check', ['revoked_by', 'revoked_at', 'revoke_reason']],
]) test(`DEV validated constraint: ${name}`, () => {
  const constraint = find('constraints', name)
  assert.equal(constraint.type, 'c')
  assert.equal(constraint.validated, true)
  contains(constraint.definition, markers)
})

for (const name of ['payment_intake_events_immutable', 'financial_command_receipts_immutable', 'payment_request_receipt_links_immutable']) {
  test(`DEV append-only ledger trigger: ${name}`, () => {
    const trigger = find('triggers', name)
    assert.equal(trigger.enabled, 'O')
    assert.match(trigger.definition, /BEFORE DELETE OR UPDATE/)
  })
}
for (const [prefix, bucket, helper] of [
  ['extraordinary_evidence', 'extraordinary-authorizations', 'extraordinary_evidence_storage_allowed'],
  ['payment_receipt_evidence_finance', 'payment-batch-documents', 'payment_receipt_evidence_storage_path_allowed'],
]) {
  test(`DEV private evidence and guarded read/write policies: ${bucket}`, () => {
    const item = catalog.buckets.find(x => x.id === bucket)
    assert.ok(item)
    assert.equal(item.public, false)
    for (const [suffix, command, column, mode] of [['insert','INSERT','with_check','true'],['select','SELECT','qual','false']]) {
      const policy = catalog.policies.find(x => x.policyname === `${prefix}_${suffix}` && x.schemaname === 'storage' && x.tablename === 'objects')
      assert.ok(policy)
      assert.deepEqual(policy.roles, ['authenticated'])
      assert.equal(policy.cmd, command)
      contains(policy[column], [bucket, `${helper}(name, ${mode})`])
    }
  })
}

test('DEV evidence helper enforces identity, company, owner and draft on upload', () => {
  contains(fn('extraordinary_evidence_storage_allowed'), ['v_actor is null', 'company_id = v_company_id', 'evidence_storage_path = p_name', "status = 'draft'", 'authorized_by = v_actor', 'extraordinary_profile_has_explicit_faculty'])
  const source = metadata('extraordinary_evidence_storage_allowed')
  assert.equal(source.volatility, 's')
  assert.doesNotMatch(source.body, /\b(?:insert|update|delete|truncate|merge|execute)\b/i)
})
test('DEV two-step extraordinary flow preserves explicit faculty, governance, expiry and Director', () => {
  assertRpcAccess('begin_extraordinary_authorization', { identityIncludes: 'p_authorization_medium' })
  contains(fn('begin_extraordinary_authorization', 'p_authorization_medium'), ['extraordinary_intent_required_before_draft','explicit_extraordinary_faculty_required','external_authorization_medium_required','director_absence_confirmation_required','cannot_wait_confirmation_required'])
  contains(fn('activate_extraordinary_authorization'), ['extraordinary_require_finance_for_company','extraordinary_draft_owner_required','optional_evidence_must_be_complete_when_present','extraordinary_policy_disabled','extraordinary_authorization_expired_or_stale','external_director_not_active_for_company','payment_request_already_executed'])
})
test('DEV ratification/dispute are Director-bound; payment confirmation requires ratification', () => {
  for (const name of ['ratify_extraordinary_authorization','dispute_extraordinary_authorization']) contains(fn(name), ['registered_external_director_required','extraordinary_authorization_not_pending_ratification','idempotency_key'])
  contains(fn('assert_extraordinary_payment_confirmation_allowed'), ['extraordinary_payment_confirmation_requires_ratification','extraordinary_confirmation_layout_mismatch','extraordinary_confirmation_layout_line_mismatch','extraordinary_confirmation_material_mismatch'])
})
test('DEV extraordinary validation locks and rechecks the authorized layout context', () => {
  contains(fn('extraordinary_validate_layout_line'), ['for update','extraordinary_authorization_is_ready','secure_extraordinary_authorization_changed','secure_extraordinary_company_mismatch','secure_extraordinary_layout_not_available'])
})
test('DEV extraordinary consumption is atomic and bound to exactly one inserted line', () => {
  const source = fn('extraordinary_consume_layout_line')
  contains(source, ['extraordinary_authorization_can_consume_layout_line','for update','consumed_layout_id = new.layout_id','consumed_layout_line_id = new.id','get diagnostics v_updated = row_count','if v_updated <> 1','authorization_consumed'])
  assert.doesNotMatch(source, /extraordinary_authorization_is_ready/)
  contains(fn('extraordinary_authorization_can_consume_layout_line'), ['other_line.id <> line.id','payment_allocation_items','payment_allocation_movements','payment_allocation_reservations','payment_receipts','payment_request_receipt_links','cash_funds','approval_material_updated_at','valid_until'])
})
test('DEV invalidation trigger compares the actual old and new row images', () => {
  const trigger = find('triggers','invalidate_extraordinary_on_material_change')
  assert.equal(trigger.enabled,'O')
  assert.match(trigger.definition,/AFTER UPDATE ON public\.payment_requests/)
  assert.match(trigger.definition,/old\.approval_material_updated_at IS DISTINCT FROM new\.approval_material_updated_at/)
  assert.doesNotMatch(trigger.definition,/UPDATE OF/)
})
test('DEV mixed close materializes only approved released items through the canonical helper', () => {
  const source = fn('materialize_closed_batch_payable_snapshots')
  contains(source, ["new.status <> 'closed'", "old.status = 'closed'", 'item.batch_id = new.id', 'item.removed_at is null', "item.director_status = 'approved'", "item.finance_release_status = 'released'", 'for v_item in', 'perform public.create_payable_snapshot_internal'])
  assert.doesNotMatch(source,/insert into public\.payable_snapshots|on conflict do nothing|exception when/i)
})
test('DEV concepts and execution data stay operational; amount, currency and company stay material', () => {
  const source = fn('mark_payment_request_material_change')
  for (const field of ['payment_concept','concept','description','company_bank_account_id','due_date','scheduled_payment_date','payment_reference']) assert.doesNotMatch(source,new RegExp(`\\b(?:old|new)\\.${field}\\b`))
  for (const field of ['company_id','amount_requested','currency','exchange_rate','request_type','payment_method']) {
    contains(source,[`old.${field}`,`new.${field}`])
  }
  assert.match(source,/is distinct from row/i)
})
test('DEV layout completion preserves approval and validates source-account company', () => {
  const source = fn('complete_payment_request_layout_data')
  contains(source,['pg_advisory_xact_lock','for update','company_account.company_id = v_request_before.company_id','operational_update_invalidated_direction_approval','approval_material_updated_at','payment_request_layout_data_locked'])
  assert.match(source,/if p_payment_concept is null then\s+v_concept := v_request_before\.payment_concept;/i)
  assert.doesNotMatch(source,/v_concept := coalesce\([\s\S]*v_request_before\.concept[\s\S]*v_request_before\.description/)
})

test('DEV receipt notifications remain link-scoped, deduplicated and versioned', () => {
  const source = fn('enqueue_payment_receipt_linked_notifications_internal')
  contains(source,['notification:payment_receipt.linked:%s:%s:v1','md5(v_recipient.email_normalized)', 'where candidate.resolution = \'eligible\'', 'on conflict (idempotency_key) do nothing'])
  assert.doesNotMatch(source,/notification:payment_receipt\.linked:[^']*@/)
  contains(fn('link_payment_receipt_to_request'),["'notification_resolution', v_notification -> 'notification_resolution'",'append_financial_outbox_event_internal','enqueue_payment_receipt_linked_notifications_internal'])
})
test('DEV receipt attachment resolver is service-only and validates the complete 1:1 chain', () => {
  assertRpcAccess('get_payment_receipt_notification_attachment',{authenticated:false,service:true})
  contains(fn('get_payment_receipt_notification_attachment'),['payment_receipt.linked','payment_request_receipt_links','bank_payment_operations','payment_operation_evidence','payment-batch-documents','application/pdf','page_count is distinct from 1','single_operation_attested','individual_sha256','file_size_bytes'])
})
test('DEV dispatcher claim requires event allowlist/cutoff and locks eligible events once', () => {
  const source = fn('claim_notification_events_for_dispatcher_v2')
  contains(source,['notification_dispatcher_event_types_required','notification_dispatcher_cutoff_required','event.created_at >= p_created_at_from','event.attempt_count < event.max_attempts','for update skip locked',"event.status in ('pending', 'failed')"])
  assert.doesNotMatch(source,/\bunnest\(p_event_types\)\s+as\s+event_type\b/)
})
test('DEV immediate wake-up uses the authoritative ledger and handles network failure', () => {
  const trigger = find('triggers','notification_payment_outcome_dispatch_after_insert')
  assert.equal(trigger.enabled,'O')
  contains(trigger.definition,['AFTER INSERT ON public.notification_events','payment_receipt.linked','pending','notification_payment_outcome_dispatch_wakeup_internal'])
  const source = fn('notification_payment_outcome_dispatch_wakeup_internal')
  contains(source,['net.http_post','exception when'])
  assert.equal(catalog.recovery_jobs.length,1)
  assert.equal(catalog.recovery_jobs[0].active,true)
  assert.equal(catalog.recovery_jobs[0].schedule,'*/5 * * * *')
  assert.doesNotMatch(source,/update public\.payment_requests|insert into public\.payment_receipts/i)
})
test('DEV financial approval catch-all rules stay disabled', () => {
  assert.equal(catalog.financial_catch_all_count,0)
})

test('DEV SQL fingerprint probes preserve UTC equivalence and distinguish material input', () => {
  const probes = catalog.fingerprint_probes
  for (const value of Object.values(probes)) assert.match(value, /^[a-f0-9]{64}$/)
  assert.equal(probes.base, probes.timezone)
  for (const key of ['actor','status','stamp','target','notes','operation','trim']) assert.notEqual(probes.base,probes[key],key)
  // The SQL helper hashes the caller material. Both RPCs normalize notes before calling it.
  for (const name of ['transition_provider_intake','add_provider_intake_note']) assert.match(fn(name), /v_notes := nullif\(btrim\(coalesce\(p_notes, ''\)\), ''\)/)
})

for (const name of ['complete_provider_payment_execution_data', 'save_provider_catalog_with_payment_execution_data', 'add_company_director_for_future_batches', 'remove_company_director_for_future_batches']) {
  test(`DEV protected catalog RPC: ${name}`, () => assertRpcAccess(name))
}
test('DEV provider banking changes require the guarded finance RPC and omit banking values from audit', () => {
  const source = fn('mark_provider_payment_material_change')
  contains(source, ['approval_batch_require_finance', 'flux.provider_payment_execution_rpc', 'provider_payment_execution_rpc_required', 'insert into public.activity_log'])
  for (const field of ['destination_type', 'clabe', 'cuenta_bancaria', 'convenio_number', 'beneficiary_name', 'banco']) contains(source, [`old.${field}`, `new.${field}`])
  assert.doesNotMatch(source, /approval_material_updated_at|update public\.payment_requests|notification_events|to_jsonb\((?:old|new)\)/i)
  const audit = source.slice(source.indexOf('insert into public.activity_log'))
  assert.doesNotMatch(audit, /\b(?:old|new)\.(?:clabe|cuenta_bancaria|convenio_number|beneficiary_name|banco)\b/)
  assert.equal(find('triggers', 'mark_provider_payment_material_change').enabled, 'O')
})
test('DEV provider banking inserts are guarded and completion returns only a safe summary', () => {
  const trigger = find('triggers', 'provider_payment_execution_data_insert_guard')
  assert.equal(trigger.enabled, 'O')
  assert.match(trigger.definition, /BEFORE INSERT ON public\.proveedores/)
  contains(fn('guard_provider_payment_execution_data_insert'), ['approval_batch_require_finance', 'provider_payment_execution_rpc_required', 'provider_payment_execution_data_invalid'])
  const source = fn('complete_provider_payment_execution_data')
  contains(source, ['approval_batch_require_finance', 'pg_advisory_xact_lock', 'for update', 'proveedor_not_found_or_inactive', 'update public.proveedores'])
  const result = source.slice(source.lastIndexOf('return jsonb_build_object'))
  assert.deepEqual([...result.matchAll(/'([^']+)'\s*,/g)].map(x => x[1]).sort(), ['changed_fields', 'completed_fields', 'execution_data_updated', 'history_preserved', 'missing_fields', 'proveedor_id'].sort())
})
test('DEV provider catalog rejects unsupported payload fields and checks finance when banking changes', () => {
  const source = fn('save_provider_catalog_with_payment_execution_data')
  contains(source, ['provider_payload_contains_unsupported_fields', 'approval_batch_require_actor', 'profile_inactive', 'jsonb_populate_record', 'pg_advisory_xact_lock', 'for update', 'provider_create_role_required', 'provider_update_role_required'])
  assert.match(source, /if v_execution_changed then\s+if not coalesce\(v_after.activo, false\)[\s\S]*?approval_batch_require_finance\(\)/)
  assert.match(source, /return jsonb_build_object\('id', v_after.id\);/)
  assert.doesNotMatch(source, /\bexecute\s|notification_events|update public\.payment_requests/i)
})
test('DEV future Director pool edits lock and audit without changing existing batches or enforcement', () => {
  for (const name of ['add_company_director_for_future_batches', 'remove_company_director_for_future_batches']) {
    const source = fn(name)
    contains(source, ['approval_batch_require_finance', 'pg_advisory_xact_lock', 'for update', 'insert into public.activity_log'])
    assert.doesNotMatch(source, /\b(?:insert\s+into|update|delete\s+from)\s+public\.(?:approval_batches|approval_batch_company_settings)\b/i)
  }
  contains(fn('add_company_director_for_future_batches'), ['director_profile_not_found_or_inactive', 'director_role_required', 'director_company_membership_required'])
  contains(fn('remove_company_director_for_future_batches'), ['last_active_company_director_required', 'already_inactive_or_not_assigned'])
  const index = find('indexes', 'company_directors_active_uidx')
  assert.equal(index.unique, true)
  assert.equal(index.valid, true)
  assert.match(index.definition, /\(company_id, director_profile_id\) WHERE active/)
  assert.equal(catalog.indexes.some(x => x.table === 'company_directors' && x.unique && /\(company_id\)/.test(x.definition)), false)
})
test('DEV new batches snapshot an explicitly selected eligible Director', () => {
  contains(fn('create_approval_batch'), ['company_director_selection_required', 'director_assignment.company_id = p_company_id', 'director_assignment.director_profile_id = p_director_id', 'director_assignment.active', 'director_profile.active', 'membership.active', 'company_director_not_active_or_ineligible', 'insert into public.approval_batches', "'director_id', p_director_id"])
})
test('DEV existing batch decisions remain bound to the stored Director after future-pool edits', () => {
  contains(fn('approval_batch_require_active_direction'), ['approval_batch_require_actor', 'director_profile_not_found_or_inactive', 'director_role_required'])
  contains(fn('list_director_approval_batches'), ['approval_batch_require_active_direction', 'batch.director_id = v_actor'])
  contains(fn('approve_entire_batch'), ['approval_batch_require_active_direction', 'approve_entire_batch_internal(p_batch_id, v_actor)'])
  for (const name of ['approve_entire_batch_internal', 'decide_approval_batch_items']) {
    const source = fn(name)
    contains(source, ['for update', 'batch_director_required', 'batch_must_be_submitted'])
    assert.match(source, /v_batch.director_id <> (?:v_actor|p_actor)/)
    assert.doesNotMatch(source, /public\.company_directors/)
  }
})
