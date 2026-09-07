from pathlib import Path

p = Path('payroll_real_formats.js')
s = p.read_text(encoding='utf-8')

old = """        people.push({ sourceRow: row, employeeName, normalizedName: normalizeName(employeeName), rfc, curp, nss: '', bankName, account, clabe,
          netAmountMinor: net, coverCashAmountMinor: cash, coverVouchersAmountMinor: vouchers, pensionAmountMinor: pension,
          bankAmountMinor: 0, speiAmountMinor: 0, vouchersAmountMinor: 0 });"""
new = """        const person = { sourceRow: row, employeeName, normalizedName: normalizeName(employeeName), rfc, curp, nss: '', bankName, account, clabe,
          netAmountMinor: net, coverCashAmountMinor: cash, coverVouchersAmountMinor: vouchers,
          bankAmountMinor: 0, speiAmountMinor: 0, vouchersAmountMinor: 0 };
        if (selected.contractVersion === FERSANA_COVER_CONTRACT_VERSION) person.pensionAmountMinor = pension;
        people.push(person);"""
if old not in s:
    raise SystemExit('person compatibility anchor missing')
s = s.replace(old, new, 1)

old = """      return { contractVersion: selected.contractVersion, sheetName: selected.sheetName, valid: issues.length === 0,
        people: issues.length ? [] : people, totals: issues.length ? null : { netAmountMinor: netTotal, cashAmountMinor: cashTotal, vouchersAmountMinor: voucherTotal, pensionAmountMinor: pensionTotal }, issues };"""
new = """      const totals = { netAmountMinor: netTotal, cashAmountMinor: cashTotal, vouchersAmountMinor: voucherTotal };
      if (selected.contractVersion === FERSANA_COVER_CONTRACT_VERSION) totals.pensionAmountMinor = pensionTotal;
      return { contractVersion: selected.contractVersion, sheetName: selected.sheetName, valid: issues.length === 0,
        people: issues.length ? [] : people, totals: issues.length ? null : totals, issues };"""
if old not in s:
    raise SystemExit('totals compatibility anchor missing')
s = s.replace(old, new, 1)

old = "const account=normalizeAccount(destination); const amountMinor=/^\\d{13}\\.\\d{2}$/.test(amountField) ? minor(amountField) : null;"
new = "const account=normalizeAccount(destination).replace(/^0+(?=\\d)/,''); const amountMinor=/^\\d{13}\\.\\d{2}$/.test(amountField) ? minor(amountField) : null;"
if old not in s:
    raise SystemExit('same-bank padded account anchor missing')
s = s.replace(old, new, 1)

p.write_text(s, encoding='utf-8')
