// contpaq_mapping_candidates.js — FB-3, reglas puras para candidatos de identidad/mapeo.
// DEV-first. No escribe DB, no asigna cuentas por heurística y no habilita FB-7.
;(function installContpaqMappingCandidates(root) {
  "use strict"

  function text(value) {
    return String(value ?? "").trim()
  }

  function normalizeDigits(value) {
    return text(value).replace(/\D/g, "")
  }

  function normalizeRfc(value) {
    return text(value).toUpperCase().replace(/[^A-Z0-9Ñ&]/g, "")
  }

  function sameCompany(expected, actual) {
    if (!expected) return false
    if (!actual) return true // permite catálogos ya filtrados por caller
    return String(expected) === String(actual)
  }

  function bankAccountCandidate(bankAccount, contpaqAccounts = []) {
    if (!bankAccount || typeof bankAccount !== "object") {
      return { status: "needs_review", reason: "bank_account_missing", matches: [] }
    }
    if (!bankAccount.company_id && !bankAccount.companyId) {
      return { status: "needs_review", reason: "bank_company_missing", matches: [] }
    }

    const companyId = bankAccount.company_id || bankAccount.companyId
    const accountNumber = normalizeDigits(bankAccount.account_number || bankAccount.accountNumber)
    if (accountNumber.length < 6) {
      return { status: "needs_review", reason: "bank_account_number_insufficient", matches: [] }
    }

    const matches = (Array.isArray(contpaqAccounts) ? contpaqAccounts : []).filter((account) => {
      if (!account || account.activo === false || account.active === false) return false
      if (account.is_detail === false || account.isDetail === false) return false
      if (!sameCompany(companyId, account.company_id || account.companyId)) return false
      const nameDigits = normalizeDigits(account.name)
      return nameDigits.includes(accountNumber)
    })

    if (matches.length === 1) {
      return { status: "matched", reason: "exact_full_account_number", matches }
    }
    if (matches.length > 1) {
      return { status: "needs_review", reason: "bank_account_ambiguous", matches }
    }
    return { status: "needs_review", reason: "bank_account_no_exact_candidate", matches: [] }
  }

  function providerIdentityCandidate(provider, companyId, thirdParties = []) {
    if (!provider || typeof provider !== "object") {
      return { status: "needs_review", reason: "provider_missing", matches: [] }
    }
    if (!companyId) {
      return { status: "needs_review", reason: "provider_company_missing", matches: [] }
    }

    const rfc = normalizeRfc(provider.rfc)
    if (!rfc) {
      return { status: "needs_review", reason: "provider_rfc_missing", matches: [] }
    }

    const matches = (Array.isArray(thirdParties) ? thirdParties : []).filter((party) => {
      if (!party) return false
      if (!sameCompany(companyId, party.company_id || party.companyId)) return false
      return normalizeRfc(party.rfc) === rfc
    })

    if (matches.length === 1) {
      return { status: "matched", reason: "exact_rfc", matches }
    }
    if (matches.length > 1) {
      return { status: "needs_review", reason: "provider_rfc_ambiguous", matches }
    }
    return { status: "needs_review", reason: "provider_rfc_no_candidate", matches: [] }
  }

  const api = Object.freeze({
    normalizeDigits,
    normalizeRfc,
    bankAccountCandidate,
    providerIdentityCandidate,
  })

  root.FluxContpaqMappingCandidates = api
  if (typeof module !== "undefined" && module.exports) module.exports = api
})(typeof window !== "undefined" ? window : globalThis)
