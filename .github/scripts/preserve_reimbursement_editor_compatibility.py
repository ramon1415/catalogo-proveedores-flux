from pathlib import Path

path = Path("app/src/features/solicitudes/ReimbursementSection.tsx")
text = path.read_text(encoding="utf-8")

old_types = """  companies: Company[]
  costCenters: CostCenter[]
  companyId: string
  costCenterId: string
  budgetMonth: string
  companyLocked: boolean
  onCompanyChange: (id: string) => void
  onCostCenterChange: (id: string) => void
  onBudgetMonthChange: (month: string) => void
  categoryHelp: { text: string; state: string }"""
new_types = """  companies?: Company[]
  costCenters?: CostCenter[]
  companyId: string
  costCenterId?: string
  budgetMonth?: string
  companyLocked?: boolean
  onCompanyChange?: (id: string) => void
  onCostCenterChange?: (id: string) => void
  onBudgetMonthChange?: (month: string) => void
  categoryHelp?: { text: string; state: string }"""
if text.count(old_types) != 1:
    raise SystemExit("optional scope prop block not found exactly once")
text = text.replace(old_types, new_types, 1)

start = """        <div className={s.reimbursementScope}>
          <div className={s.reimbursementScopeIntro}>"""
wrapped_start = """        {companies && costCenters && costCenterId !== undefined && budgetMonth !== undefined
          && onCompanyChange && onCostCenterChange && onBudgetMonthChange && categoryHelp ? (
          <div className={s.reimbursementScope}>
            <div className={s.reimbursementScopeIntro}>"""
if text.count(start) != 1:
    raise SystemExit("scope start not found exactly once")
text = text.replace(start, wrapped_start, 1)

end = """        </div>

        <div className={`${s.fieldHint} ${s.fullRow}`}>"""
wrapped_end = """          </div>
        ) : null}

        <div className={`${s.fieldHint} ${s.fullRow}`}>"""
if text.count(end) != 1:
    raise SystemExit("scope end not found exactly once")
text = text.replace(end, wrapped_end, 1)
text = text.replace("disabled={companyLocked}", "disabled={companyLocked === true}", 1)
text = text.replace("{!companyLocked && <option", "{companyLocked !== true && <option", 1)

path.write_text(text, encoding="utf-8")
