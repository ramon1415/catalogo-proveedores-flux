from pathlib import Path

api = Path('app/src/features/nomina/api.ts')
text = api.read_text(encoding='utf-8')
anchor = "// ── RPC 8: submit_payroll_for_approval"
if anchor not in text:
    raise SystemExit('api anchor not found')
block = """// Confirmación explícita de Finanzas para Nómina no presupuestal.
export async function confirmPayrollFinanceReview(paymentRequestId: string): Promise<{ status: string; payment_request_id: string; request_number?: string }> {
  const { data, error } = await supabase.rpc('confirm_payroll_finance_review', {
    p_payment_request_id: paymentRequestId,
  })
  if (error) throw error
  return data as { status: string; payment_request_id: string; request_number?: string }
}

"""
if 'confirmPayrollFinanceReview' not in text:
    text = text.replace(anchor, block + anchor, 1)
api.write_text(text, encoding='utf-8')

modal = Path('app/src/features/nomina/CaptureModal.tsx')
text = modal.read_text(encoding='utf-8')
text = text.replace('  listApproverOptions,\n', '')
text = text.replace('  submitForApproval,\n', '')
text = text.replace('  getSubmissionSummary,\n', '  getSubmissionSummary,\n  confirmPayrollFinanceReview,\n')
text = text.replace('  ApproverCandidate,\n', '')
text = text.replace("  const [approvers, setApprovers] = useState<ApproverCandidate[]>([])\n  const [approverValue, setApproverValue] = useState('')\n", '')

old = '''  async function loadSubmissionSummary(requestId: string): Promise<{ data: SubmissionSummary; options: ApproverCandidate[] }> {
    const data = await getSubmissionSummary(requestId)
    setSummary(data)
    let options: ApproverCandidate[] = []
    if (data.status === 'draft') {
      try {
        options = await listApproverOptions(data.company_id, data.cost_center_id, Number(data.amount_requested))
      } catch (error) {
        showToast('Aprobadores no disponibles', friendlyError(error), 'warning')
      }
    }
    setApprovers(options)
    setApproverValue((current) => {
      if (options.some((option) => option.profile_id === current)) return current
      return options.length === 1 ? options[0].profile_id : ''
    })
    return { data, options }
  }
'''
new = '''  async function loadSubmissionSummary(requestId: string): Promise<SubmissionSummary> {
    const data = await getSubmissionSummary(requestId)
    setSummary(data)
    return data
  }
'''
if old not in text:
    raise SystemExit('loadSubmissionSummary block not found')
text = text.replace(old, new, 1)

old = '''      setProgressText('Preparando aprobación…')
      const loaded = await loadSubmissionSummary(requestId)
      const vales = loaded.data.channels?.find((channel) => channel.channel === 'vales')
      const variance = Number(vales?.funding_variance || 0)
      if (variance !== 0 && !vales?.funding_variance_acknowledged) {
        showToast('Corrida registrada', 'Revisa y reconoce la diferencia TOKA para continuar a aprobación.', 'warning')
        onSaved()
        return
      }
      if (loaded.data.budget_ready !== true) {
        showToast('Corrida registrada', 'El paquete quedó validado; falta completar el gate presupuestal.', 'warning')
        onSaved()
        return
      }
      if (loaded.options.length !== 1) {
        showToast(
          'Corrida registrada',
          loaded.options.length > 1 ? 'Selecciona el aprobador para completar el envío.' : 'No hay un aprobador elegible para este contexto.',
          'warning',
        )
        onSaved()
        return
      }

      setProgressText('Enviando a aprobación…')
      const option = loaded.options[0]
      await submitForApproval(requestId, option.profile_id, option.assignment_id || null)
      await loadSubmissionSummary(requestId)
      onSaved()
      showToast('Nómina enviada', 'La corrida quedó registrada y enviada a aprobación.', 'success')
'''
new = '''      setProgressText('Preparando revisión de Finanzas…')
      const loaded = await loadSubmissionSummary(requestId)
      const vales = loaded.channels?.find((channel) => channel.channel === 'vales')
      const variance = Number(vales?.funding_variance || 0)
      onSaved()
      if (variance !== 0 && !vales?.funding_variance_acknowledged) {
        showToast('Corrida registrada', 'Revisa y reconoce la diferencia TOKA; después confirma que los montos son correctos.', 'warning')
        return
      }
      showToast('Corrida registrada', 'El paquete quedó validado. Revisa los montos y confirma que son correctos para habilitar la dispersión.', 'success')
'''
if old not in text:
    raise SystemExit('register approval block not found')
text = text.replace(old, new, 1)

old = '''  async function submit() {
    if (submitting || !summary || !materializedRequestId) return
    const option = approvers.find((candidate) => candidate.profile_id === approverValue)
    if (!option) {
      showToast('Aprobador requerido', 'Selecciona un aprobador elegible.', 'warning')
      return
    }
    if (summary.status === 'draft' && summary.budget_ready === false) {
      showToast('Presupuesto requerido', 'Configura y valida el presupuesto antes de enviar la Nómina a aprobación.', 'warning')
      return
    }
    setSubmitting(true)
    try {
      await submitForApproval(materializedRequestId, option.profile_id, option.assignment_id || null)
      await loadSubmissionSummary(materializedRequestId)
      onSaved()
      showToast('Enviada a aprobación', 'La Nómina quedó enviada al aprobador seleccionado.', 'success')
    } catch (error) {
      showToast('No se pudo enviar', friendlyError(error), 'error')
    } finally {
      setSubmitting(false)
    }
  }
'''
new = '''  async function confirmAmounts() {
    if (submitting || !summary || !materializedRequestId || summary.status !== 'draft') return
    if (needsReview) {
      showToast('Revisión TOKA pendiente', 'Reconoce primero la diferencia de fondeo TOKA.', 'warning')
      return
    }
    setSubmitting(true)
    try {
      await confirmPayrollFinanceReview(materializedRequestId)
      await loadSubmissionSummary(materializedRequestId)
      onSaved()
      showToast('Montos confirmados', 'Finanzas confirmó la corrida. Ya está lista para dispersión y comprobantes bancarios por canal.', 'success')
    } catch (error) {
      showToast('No se pudo confirmar la corrida', friendlyError(error), 'error')
    } finally {
      setSubmitting(false)
    }
  }
'''
if old not in text:
    raise SystemExit('submit function block not found')
text = text.replace(old, new, 1)

text = text.replace("  const budgetReady = summary?.budget_ready === true\n  const approvalReady = isDraft && !needsReview && budgetReady\n  const budgetBlocked = summary?.budget_decision === 'bloqueado'\n", "  const financeReviewReady = isDraft && !needsReview\n")
text = text.replace('subtitle="Sube el paquete, revísalo y envía. Registra la corrida; no calcula sueldos ni ejecuta pagos."', 'subtitle="Sube el paquete, revisa los montos y confirma la corrida. Nómina no consume presupuesto y Flux no ejecuta pagos."')
text = text.replace("{workflowBusy ? progressText || 'Procesando…' : 'Registrar y enviar a aprobación'}", "{workflowBusy ? progressText || 'Procesando…' : 'Registrar y revisar montos'}")
text = text.replace('Se conservan las mismas RPC, carga privada, SHA-256, validación del servidor y auditoría.', 'La corrida se valida en servidor. No hace comprobación presupuestal ni requiere aprobador.')

budget_block = '''            {isDraft && !budgetReady && (
              <div className={`${s.budgetGate} ${budgetBlocked ? s.budgetBlocked : s.budgetPending}`}>
                <div>
                  <strong>{budgetBlocked ? 'Presupuesto bloqueado' : 'Presupuesto pendiente'}</strong>
                  <p>{summary.budget_block_reason || 'Configura mes y partida presupuestal antes de enviar.'}</p>
                </div>
                {materializedRequestId && <a className={s.secondaryBtn} href={`/legacy/nomina_presupuesto.html?request_id=${encodeURIComponent(materializedRequestId)}`}>Configurar presupuesto</a>}
              </div>
            )}

'''
if budget_block not in text:
    raise SystemExit('budget block not found')
text = text.replace(budget_block, '', 1)

approval_block = '''            {approvalReady && (
              <div className={s.approval}>
                <label>
                  Aprobador *
                  <select value={approverValue} onChange={(event) => setApproverValue(event.target.value)}>
                    <option value="">Selecciona aprobador</option>
                    {approvers.map((approver) => <option key={approver.profile_id} value={approver.profile_id}>{approver.option_label || approver.display_name || approver.email || approver.profile_id}</option>)}
                  </select>
                </label>
                <button type="button" className={s.primaryBtn} onClick={submit} disabled={!approverValue || submitting}>{submitting ? 'Enviando…' : 'Continuar y enviar a aprobación'}</button>
              </div>
            )}
'''
confirm_block = '''            {financeReviewReady && (
              <div className={s.approval}>
                <div>
                  <strong>Revisión de Finanzas</strong>
                  <p>Verifica el neto y los importes de BBVA, SPEI y TOKA. Al confirmar, la corrida queda lista para registrar dispersión y comprobantes. Flux no ejecuta pagos.</p>
                </div>
                <button type="button" className={s.primaryBtn} onClick={confirmAmounts} disabled={submitting}>{submitting ? 'Confirmando…' : 'Confirmar montos correctos'}</button>
              </div>
            )}
'''
if approval_block not in text:
    raise SystemExit('approval block not found')
text = text.replace(approval_block, confirm_block, 1)

old_state = '''            <p className={s.submissionState}>
              {isDraft
                ? needsReview
                  ? 'Reconoce la diferencia TOKA antes de continuar.'
                  : !budgetReady
                    ? 'Completa el gate presupuestal antes de continuar.'
                    : approvers.length
                      ? 'Lista para enviar.'
                      : 'No hay aprobadores elegibles para este contexto.'
                : `Estado de solicitud: ${summary.status}`}
            </p>
'''
new_state = '''            <p className={s.submissionState}>
              {isDraft
                ? needsReview
                  ? 'Reconoce la diferencia TOKA antes de confirmar la corrida.'
                  : 'Lista para confirmación de Finanzas. Sin presupuesto y sin aprobador.'
                : summary.status === 'approved'
                  ? 'Corrida confirmada por Finanzas · lista para dispersión y comprobantes.'
                  : `Estado de solicitud: ${summary.status}`}
            </p>
'''
if old_state not in text:
    raise SystemExit('submission state block not found')
text = text.replace(old_state, new_state, 1)
modal.write_text(text, encoding='utf-8')

logic = Path('app/src/features/nomina/logic.ts')
text = logic.read_text(encoding='utf-8')
marker = "  PAYROLL_TOKA_FUNDING_SERVER_PARSE_FAILED: 'El TXT de fondeo TOKA no coincide con el contrato certificado.',\n"
extra = "  PAYROLL_NON_BUDGET_CONTEXT_REQUIRED: 'Esta corrida no tiene el nuevo contexto no presupuestal. Crea una captura nueva para usar el flujo actual.',\n  PAYROLL_APPROVAL_FLOW_DISABLED: 'La Nómina ya no usa aprobación. Revisa los montos y confirma la corrida desde Finanzas.',\n  PAYROLL_FINANCE_CONFIRM_RPC_REQUIRED: 'La confirmación debe realizarse desde la acción de revisión de Finanzas.',\n"
if marker in text and 'PAYROLL_NON_BUDGET_CONTEXT_REQUIRED' not in text:
    text = text.replace(marker, marker + extra, 1)
logic.write_text(text, encoding='utf-8')
