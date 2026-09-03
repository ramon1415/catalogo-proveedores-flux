import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { renderEmail } from '../../supabase/functions/notification-dispatcher/index.ts'

const migration = fs.readFileSync(
  'supabase/migrations/20260903061000_harden_reimbursement_permissions.sql',
  'utf8',
)
const page = fs.readFileSync('app/src/features/solicitudes/SolicitudesPage.tsx', 'utf8')
const detail = fs.readFileSync('app/src/features/solicitudes/DetailModal.tsx', 'utf8')
const editor = fs.readFileSync('app/src/features/solicitudes/ReimbursementEditModal.tsx', 'utf8')
const api = fs.readFileSync('app/src/features/solicitudes/api.ts', 'utf8')
const logic = fs.readFileSync('app/src/features/solicitudes/logic.ts', 'utf8')
const weeklyCuts = fs.readFileSync('approval_batches.js', 'utf8')
const layoutPreview = fs.readFileSync('app/src/features/layouts/EligibilityPreview.tsx', 'utf8')
const submittedPdf = fs.readFileSync(
  'supabase/functions/approval-batch-submitted-dispatcher/index.ts',
  'utf8',
)
const decisionPdf = fs.readFileSync(
  'supabase/functions/notification-dispatcher/approval_batch_decision_pdf.ts',
  'utf8',
)
const notificationDispatcher = fs.readFileSync(
  'supabase/functions/notification-dispatcher/index.ts',
  'utf8',
)

test('server enforces operator equals requester equals beneficiary', () => {
  assert.match(migration, /create or replace function private\.enforce_reimbursement_actor_scope/)
  assert.match(migration, /new\.requested_by is distinct from v_actor/)
  assert.match(migration, /new\.beneficiary_profile_id is distinct from v_actor/)
  assert.match(migration, /reimbursement_operator_must_be_own_beneficiary/)
  assert.match(migration, /create trigger reimbursement_actor_scope_guard/)
})

test('beneficiary company validation is RLS-safe without exposing membership rows', () => {
  assert.match(migration, /create or replace function private\.enforce_payment_request_tenant_references\(\)/)
  assert.match(
    migration,
    /public\.has_active_company_membership\(\s*new\.beneficiary_profile_id,\s*new\.company_id\s*\)/s,
  )
  assert.match(
    migration,
    /public\.has_active_company_membership\(\s*p_beneficiary_profile_id,\s*v_request\.company_id\s*\)/s,
  )
  assert.match(
    migration,
    /revoke all on function private\.enforce_payment_request_tenant_references\(\)\s*from public, anon, authenticated/s,
  )
})

test('terminal reimbursements are immutable and direction cannot change business data', () => {
  assert.match(
    migration,
    /old\.status::text in \('approved','scheduled','paid','rejected','cancelled'\)[\s\S]*v_business_changed/,
  )
  assert.match(migration, /reimbursement_terminal_request_immutable/)
  assert.match(
    migration,
    /old\.requested_by is distinct from v_actor[\s\S]*reimbursement_finance_role_required_for_edit/,
  )
})

test('operator can insert only the initial self-owned breakdown', () => {
  assert.match(
    migration,
    /create policy reimbursement_items_insert[\s\S]*request\.requested_by = public\.current_profile_id\(\)[\s\S]*request\.beneficiary_profile_id = public\.current_profile_id\(\)[\s\S]*request\.status::text = 'submitted'/,
  )
  assert.match(migration, /private\.reimbursement_has_no_items\(\s*request\.id,\s*request\.company_id\s*\)/s)
  assert.match(
    migration,
    /create or replace function private\.reimbursement_has_no_items[\s\S]*stable[\s\S]*security definer/,
  )
  assert.match(
    migration,
    /create policy reimbursement_items_update[\s\S]*array\['finance','sysadmin'\]/,
  )
  assert.match(
    migration,
    /create policy reimbursement_items_delete[\s\S]*array\['finance','sysadmin'\]/,
  )
})

test('finance edit RPC is authenticated, company scoped and rejects terminal rows', () => {
  assert.match(migration, /create or replace function public\.update_reimbursement_request/)
  assert.match(migration, /if auth\.uid\(\) is null or v_actor is null/)
  assert.match(
    migration,
    /current_profile_has_company_role\([\s\S]*v_request\.company_id, array\['finance','sysadmin'\]/,
  )
  assert.match(migration, /public\.has_active_company_membership/)
  assert.match(migration, /account\.company_id = v_request\.company_id/)
  assert.match(migration, /revoke all on function public\.update_reimbursement_request[\s\S]*from public, anon/)
  assert.match(migration, /grant execute on function public\.update_reimbursement_request[\s\S]*to authenticated, service_role/)
})

test('finance edit recalculates the authoritative amount and budget from items', () => {
  assert.match(migration, /v_total := v_total \+ v_amount/)
  assert.match(migration, /v_dominant_category_id := v_category_id/)
  assert.match(migration, /public\.verify_budget_availability/)
  assert.match(migration, /v_available_before[\s\S]*\+ v_old_budget_amount/)
  assert.match(migration, /amount_requested = v_total/)
  assert.match(migration, /delete from public\.reimbursement_items/)
  assert.match(migration, /insert into public\.reimbursement_items/)
})

test('React exposes editing only to finance or sysadmin', () => {
  assert.match(page, /const canEditRequest = perms\.isAdminFinance\(group\)/)
  assert.match(page, /canEditRequest=\{canEditRequest\}/)
  assert.match(detail, /const canEdit = canEditRequest && !isTerminalStatus\(request\.status\)/)
  assert.doesNotMatch(detail, /const canEdit = canApprove/)
})

test('reimbursements use their dedicated editor and never the provider editor', () => {
  assert.match(page, /editIsReimbursement/)
  assert.match(page, /<ReimbursementEditModal/)
  assert.match(page, /editRequest && !editIsReimbursement/)
  assert.match(editor, /<h2>Editar reembolso<\/h2>/)
  assert.match(editor, /<ReimbursementSection/)
  assert.doesNotMatch(editor, /ProviderCombo/)
})

test('deductible persisted receipts remain valid while editing', () => {
  assert.match(editor, /existingStoragePath: item\.storage_path/)
  assert.match(editor, /storagePath = item\.existingStoragePath \|\| null/)
  assert.match(logic, /item\.deducible && !item\.file && !item\.existingStoragePath/)
})

test('React sends one transactional reimbursement update RPC', () => {
  assert.match(api, /supabase\.rpc\('update_reimbursement_request'/)
  assert.match(api, /p_beneficiary_profile_id: payload\.beneficiary_profile_id/)
  assert.match(api, /p_items: payload\.items/)
  assert.match(editor, /await updateReimbursementRequest\(/)
})

test('weekly-cut eligibility replaces provider with an active employee beneficiary', () => {
  assert.match(migration, /rename to approval_batch_request_eligibility_pre_reimb/)
  assert.match(
    migration,
    /where value not in \('proveedor_id', 'proveedor_not_found', 'proveedor_inactive'\)/,
  )
  assert.match(migration, /v_request\.beneficiary_profile_id is null/)
  assert.match(
    migration,
    /public\.has_active_company_membership\(\s*v_request\.beneficiary_profile_id,\s*v_request\.company_id\s*\)/s,
  )
  assert.match(migration, /'classification', 'ready_for_batch'/)
  assert.match(migration, /'budget_authorization_source'/)
})

test('weekly-cut lists and detail resolve the employee without creating a provider', () => {
  assert.match(migration, /create or replace function private\.payment_request_payee_document/)
  assert.match(migration, /beneficiary_bank\.company_id = request\.company_id/)
  assert.match(migration, /'payee_kind', case/)
  assert.match(migration, /then 'employee_beneficiary'/)
  assert.match(migration, /rename to list_batch_eligible_requests_pre_reimb/)
  assert.match(migration, /rename to get_approval_batch_detail_pre_reimb/)
  assert.match(weeklyCuts, /Proveedor \/ beneficiario/)
  assert.match(weeklyCuts, /proveedor_o_beneficiario/)
})

test('submitted and decision documents carry the employee beneficiary', () => {
  assert.match(
    migration,
    /rename to get_approval_batch_submitted_notification_document_pre_reimb/,
  )
  assert.match(
    migration,
    /rename to get_approval_batch_decision_notification_document_pre_reimb/,
  )
  assert.match(
    migration,
    /private\.payment_request_payee_document\(batch_item\.payment_request_id\)/,
  )
  assert.match(submittedPdf, /Proveedor \/ beneficiario/)
  assert.match(decisionPdf, /Proveedor \/ beneficiario/)
})

test('layout candidates use the employee account and remove provider-only blockers', () => {
  assert.match(
    migration,
    /rename to complete_payment_request_layout_data_pre_reimb/,
  )
  assert.match(
    migration,
    /if not v_is_reimbursement then[\s\S]*complete_payment_request_layout_data_pre_reimb/,
  )
  assert.match(
    migration,
    /from public\.employee_bank_accounts account[\s\S]*account\.company_id = v_request_before\.company_id/,
  )
  assert.match(migration, /create or replace function private\.reimbursement_layout_missing_fields/)
  assert.match(
    migration,
    /where field not in \([\s\S]*'proveedor_id'[\s\S]*'convenio_number_invalid'[\s\S]*\)/,
  )
  assert.match(
    migration,
    /public\.payment_request_layout_missing_fields\(p_request\)/,
  )
  assert.match(migration, /beneficiary_bank\.company_id = request\.company_id/)
  assert.match(migration, /then 'ready_regular'/)
  assert.match(migration, /normalized\.effective_missing_fields/)
  assert.match(layoutPreview, /Sin proveedor \/ beneficiario/)
})

test('new private helpers are not callable from the browser', () => {
  assert.match(
    migration,
    /revoke all on function private\.payment_request_payee_document\(uuid\)\s+from public, anon, authenticated/s,
  )
  assert.match(
    migration,
    /revoke all on function private\.reimbursement_layout_missing_fields\([\s\S]*from public, anon, authenticated/,
  )
  assert.match(
    migration,
    /revoke all on function public\.approval_batch_payment_layout_candidates\([\s\S]*from public, anon, authenticated/,
  )
})

test('receipt snapshot matching is null-safe for reimbursement layout lines', () => {
  assert.match(migration, /do \$receipt_baseline\$/)
  assert.match(migration, /reimbursement_receipt_baseline_changed:snapshot/)
  assert.match(migration, /reimbursement_receipt_baseline_changed:candidates/)
  assert.match(migration, /reimbursement_receipt_baseline_changed:link/)
  assert.match(migration, /reimbursement_receipt_baseline_changed:notification/)
  assert.match(migration, /reimbursement_receipt_baseline_changed:attachment/)
  assert.match(
    migration,
    /rename to payment_reconciliation_snapshot_is_receipt_matchable_pre_reimb/,
  )
  assert.match(
    migration,
    /if not v_is_reimbursement then[\s\S]*payment_reconciliation_snapshot_is_receipt_matchable_pre_reimb/,
  )
  assert.match(
    migration,
    /line\.proveedor_id is not distinct from v_request\.proveedor_id/g,
  )
  assert.match(migration, /v_total_legacy_receipts <> 1/)
  assert.match(migration, /approval_batch_request_has_current_direction_approval/)
})

test('receipt candidate matching uses the employee account inside the request company', () => {
  assert.match(migration, /rename to find_payment_receipt_candidates_pre_reimb/)
  assert.match(
    migration,
    /account\.profile_id = request\.beneficiary_profile_id[\s\S]*account\.company_id = request\.company_id/,
  )
  assert.match(migration, /payment_reconciliation_account_hash\(account\.clabe\)/)
  assert.match(migration, /payment_reconciliation_account_hash\(account\.cuenta\)/)
  assert.match(migration, /'payee_kind', 'employee_beneficiary'/)
  assert.match(migration, /candidate\.account_match or candidate\.name_match/)
})

test('receipt linking delegates providers and closes reimbursements with beneficiary matching', () => {
  assert.match(migration, /rename to link_payment_receipt_to_request_pre_reimb/)
  assert.match(
    migration,
    /if not v_is_reimbursement then[\s\S]*link_payment_receipt_to_request_pre_reimb/,
  )
  assert.match(migration, /reimbursement_beneficiary_membership_required/)
  assert.match(migration, /reimbursement_bank_account_not_found/)
  assert.match(migration, /receipt_request_beneficiary_mismatch/)
  assert.match(migration, /accepted_payment_extraction_required/)
  assert.match(migration, /shareable_single_page_evidence_required/)
  assert.match(migration, /payment_reconciliation_store_command/)
  assert.match(migration, /status = 'paid'::public\.payment_request_status/)
})

test('paid reimbursement notifies requester and beneficiary with a private PDF', () => {
  assert.match(
    migration,
    /alter table public\.notification_events[\s\S]*drop constraint notification_events_recipient_type_check/,
  )
  assert.match(migration, /'usuario_beneficiario'/)
  assert.match(
    migration,
    /rename to enqueue_payment_receipt_linked_notifications_provider/,
  )
  assert.match(migration, /'beneficiary'::text/)
  assert.match(migration, /'provider', 'not_applicable'/)
  assert.match(migration, /'request_type', 'reimbursement'/)
  assert.match(
    migration,
    /rename to get_payment_receipt_notification_attachment_provider/,
  )
  assert.match(migration, /private\.payment_request_payee_document\(v_request\.id\)/)
  assert.match(
    migration,
    /revoke all on function public\.get_payment_receipt_notification_attachment\(uuid\)[\s\S]*from public, anon, authenticated, service_role/,
  )
  assert.match(notificationDispatcher, /Beneficiario del reembolso/)
  assert.match(notificationDispatcher, /payload\.payee_kind/)

  const baseEvent = {
    id: '11111111-1111-4111-8111-111111111111',
    event_type: 'payment_receipt.linked',
    source_table: 'payment_request_receipt_links',
    source_id: '22222222-2222-4222-8222-222222222222',
    source_folio: 'REEM-2026-0001',
    recipient_type: 'usuario_beneficiario',
    recipient_profile_id: '33333333-3333-4333-8333-333333333333',
    recipient_email: 'beneficiario@example.invalid',
    subject: 'Comprobante de reembolso disponible — REEM-2026-0001',
    payload: {
      recipient_roles: ['beneficiary'],
      folio: 'REEM-2026-0001',
      provider: 'Persona Colaboradora',
      company: 'Empresa de prueba',
      concept: 'Reembolso de prueba',
      amount: '123.45',
      currency: 'MXN',
      payment_date: '2026-09-03',
      reference_hint: 'ABC123',
      status: 'paid',
      request_type: 'reimbursement',
      payee_kind: 'employee_beneficiary',
    },
    attempt_count: 0,
    priority: 'normal',
  }
  const reimbursementEmail = renderEmail(baseEvent, 'real')
  assert.match(reimbursementEmail.text, /Beneficiario del reembolso: Persona Colaboradora/)
  assert.doesNotMatch(reimbursementEmail.text, /Proveedor: Persona Colaboradora/)

  const providerEmail = renderEmail({
    ...baseEvent,
    recipient_type: 'usuario_solicitante',
    payload: {
      ...baseEvent.payload,
      request_type: 'provider_payment',
      payee_kind: 'provider',
    },
  }, 'real')
  assert.match(providerEmail.text, /Proveedor: Persona Colaboradora/)
})
