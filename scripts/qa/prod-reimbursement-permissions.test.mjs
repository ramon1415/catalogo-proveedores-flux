import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

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
