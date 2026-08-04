;(function paymentBatchParserFactory(root, factory) {
  const api = factory()
  if (typeof module === "object" && module.exports) module.exports = api
  if (root) root.FluxPaymentBatchParser = api
})(typeof globalThis !== "undefined" ? globalThis : this, function createPaymentBatchParser() {
  "use strict"

  const PARSER_VERSION = "bbva-pdf-v1"
  const MONTHS = Object.freeze({
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    setiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12,
  })

  function cleanText(value) {
    return String(value == null ? "" : value)
      .replace(/\u00a0/g, " ")
      .replace(/[\t\r]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  }

  function normalizeForMatch(value) {
    return cleanText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
  }

  function normalizeCurrency(value, fallback = "MXN") {
    const normalized = normalizeForMatch(value).replace(/\s+/g, "")
    if (!normalized) return fallback
    if (/^(mxn|mxp|mn|m\.n\.|pesos?|pesosmexicanos?)$/.test(normalized)) return "MXN"
    if (/^(usd|us\$|dolares?|dollars?)$/.test(normalized)) return "USD"
    if (/^(eur|euros?)$/.test(normalized)) return "EUR"
    if (normalized === "$" || normalized.includes("monedanacional")) return fallback
    return /^[a-z]{3}$/.test(normalized) ? normalized.toUpperCase() : fallback
  }

  function normalizedMoneyParts(value, minorUnits) {
    let source = cleanText(value)
    if (!source) return null
    const negative = /^\s*-/.test(source) || /^\s*\(/.test(source)
    source = source.replace(/[^0-9.,]/g, "")
    if (!source || !/\d/.test(source)) return null

    const lastDot = source.lastIndexOf(".")
    const lastComma = source.lastIndexOf(",")
    let decimalSeparator = ""
    if (lastDot >= 0 && lastComma >= 0) {
      decimalSeparator = lastDot > lastComma ? "." : ","
    } else {
      const separator = lastDot >= 0 ? "." : lastComma >= 0 ? "," : ""
      if (separator) {
        const index = source.lastIndexOf(separator)
        const decimals = source.length - index - 1
        if (decimals > 0 && decimals <= minorUnits) decimalSeparator = separator
        else if (decimals === 3 && index > 1) return null
      }
    }

    const pieces = decimalSeparator ? source.split(decimalSeparator) : [source]
    if (pieces.length > 2) {
      const decimals = pieces.pop()
      pieces.splice(0, pieces.length, pieces.join(""), decimals)
    }
    const whole = (pieces[0] || "0").replace(/[.,]/g, "").replace(/^0+(?=\d)/, "") || "0"
    const decimals = (pieces[1] || "").replace(/[.,]/g, "")
    if (decimals.length > minorUnits) return null
    return { negative, whole, decimals: decimals.padEnd(minorUnits, "0") }
  }

  function parseMoneyToMinor(value, minorUnits = 2) {
    const scale = Number(minorUnits)
    if (!Number.isInteger(scale) || scale < 0 || scale > 6) return null
    const parts = normalizedMoneyParts(value, scale)
    if (!parts) return null
    try {
      const factor = BigInt(`1${"0".repeat(scale)}`)
      const fraction = BigInt(parts.decimals || "0")
      const amount = (BigInt(parts.whole) * factor + fraction) * (parts.negative ? -1n : 1n)
      if (amount > BigInt(Number.MAX_SAFE_INTEGER) || amount < BigInt(Number.MIN_SAFE_INTEGER)) return null
      return Number(amount)
    } catch (_) {
      return null
    }
  }

  function formatMinorForDisplay(value, currency = "MXN") {
    const number = typeof value === "number"
      ? value
      : /^-?\d+$/.test(String(value == null ? "" : value)) ? Number(value) : NaN
    const safe = Number.isSafeInteger(number) ? number : 0
    const minor = BigInt(safe)
    const negative = minor < 0n
    const absolute = negative ? -minor : minor
    const whole = absolute / 100n
    const fraction = String(absolute % 100n).padStart(2, "0")
    const grouped = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(whole)
    return `${negative ? "-" : ""}${normalizeCurrency(currency)} ${grouped}.${fraction}`
  }

  function toIsoDate(year, month, day) {
    const y = Number(year)
    const m = Number(month)
    const d = Number(day)
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null
    if (y < 2000 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null
    const date = new Date(Date.UTC(y, m - 1, d))
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  }

  function parseDate(value) {
    const text = normalizeForMatch(value)
    let match = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/)
    if (match) return toIsoDate(match[3], match[2], match[1])
    match = text.match(/\b(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})\b/)
    if (match) return toIsoDate(match[1], match[2], match[3])
    match = text.match(/\b(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})\b/)
    if (match && MONTHS[match[2]]) return toIsoDate(match[3], MONTHS[match[2]], match[1])
    return null
  }

  function linesFromTextItems(items, tolerance = 2.5) {
    const rows = []
    ;(Array.isArray(items) ? items : []).forEach((item, index) => {
      const text = cleanText(item && item.str)
      if (!text) return
      const transform = Array.isArray(item && item.transform) ? item.transform : []
      const x = Number(transform[4] || 0)
      const y = Number(transform[5] || 0)
      let row = rows.find((candidate) => Math.abs(candidate.y - y) <= tolerance)
      if (!row) {
        row = { y, parts: [] }
        rows.push(row)
      }
      row.parts.push({ x, index, text })
    })
    return rows
      .sort((left, right) => right.y - left.y)
      .map((row) => row.parts
        .sort((left, right) => left.x - right.x || left.index - right.index)
        .map((part) => part.text)
        .join(" "))
      .map(cleanText)
      .filter(Boolean)
  }

  function valueAfterLabel(lines, patterns) {
    const source = Array.isArray(lines) ? lines : []
    for (let index = 0; index < source.length; index += 1) {
      const line = source[index]
      for (const pattern of patterns) {
        const match = line.match(pattern)
        if (!match) continue
        const inline = cleanText(match[1] || line.slice(match.index + match[0].length))
        if (inline) return inline
        const next = cleanText(source[index + 1])
        if (next) return next
      }
    }
    return ""
  }

  function moneyCandidate(lines) {
    const labelled = valueAfterLabel(lines, [
      /(?:importe|monto|cantidad)(?:\s+(?:de\s+la\s+operacion|operacion))?\s*[:\-]?\s*(.*)$/i,
      /(?:total\s+(?:pagado|transferido))\s*[:\-]?\s*(.*)$/i,
    ])
    if (labelled && /\d/.test(labelled)) return labelled
    for (const line of lines) {
      const match = line.match(/(?:MXN|MXP|USD|EUR|\$)\s*-?\s*\d[\d.,]*/i) || line.match(/-?\d[\d,]*\.\d{2}\s*(?:MXN|MXP|USD|EUR)?/i)
      if (match) return match[0]
    }
    return ""
  }

  function currencyCandidate(lines, amountText) {
    const joined = `${amountText} ${lines.join(" ")}`
    const match = joined.match(/\b(MXN|MXP|USD|EUR)\b|US\$|M\.N\.|\bpesos?\b/i)
    return match ? normalizeCurrency(match[0], null) : null
  }

  function firstSpecificMatch(lines, pattern, group = 1) {
    for (const line of Array.isArray(lines) ? lines : []) {
      const match = line.match(pattern)
      if (match && cleanText(match[group])) return cleanText(match[group])
    }
    return ""
  }

  function bbvaBeneficiary(lines) {
    const source = Array.isArray(lines) ? lines : []
    for (let index = 0; index < source.length; index += 1) {
      const line = source[index]
      const doubleLabel = line.match(/titular\s+de\s+la\s+cuenta\s*:\s*.+titular\s+de\s+la\s+cuenta\s*:\s*(.*)$/i)
      const singleDestination = line.match(/titular\s+(?:de\s+la\s+)?cuenta\s+(?:de\s+)?dep[oó]sito\s*:\s*(.*)$/i)
      const value = cleanText(doubleLabel?.[1] || singleDestination?.[1])
      if (!value) continue
      const continuation = cleanText(source[index + 1])
      if (continuation && !/:/.test(continuation) && /^[A-ZÁÉÍÓÚÑ0-9 .,&/-]+$/.test(continuation)) {
        return cleanText(`${value} ${continuation}`)
      }
      return value
    }
    return valueAfterLabel(source, [/(?:beneficiario|nombre\s+del\s+beneficiario|titular\s+destino)\s*[:\-]?\s*(.*)$/i])
  }

  function redactSensitiveText(value) {
    return cleanText(value)
      .replace(/(?:\d[^A-Za-z0-9]*){9,19}\d/g, (account) => {
        const digits = account.replace(/\D/g, "")
        return `••••${digits.slice(-4)}`
      })
      .replace(/\b[A-Z0-9]{24,}\b/gi, (token) => `${token.slice(0, 4)}…${token.slice(-4)}`)
  }

  function parseBbvaPage(page, options = {}) {
    const pageNumber = Math.max(1, Number(page && (page.pageNumber || page.page_number)) || 1)
    const lines = Array.isArray(page && page.lines)
      ? page.lines.map(cleanText).filter(Boolean)
      : linesFromTextItems(page && page.items)
    const amountText = firstSpecificMatch(lines, /\bimporte\s*:\s*([0-9][0-9.,]*)/i) || moneyCandidate(lines)
    const currency = currencyCandidate(lines, amountText)
    const amountMinor = parseMoneyToMinor(amountText)
    const dateText = firstSpecificMatch(lines, /fecha\s+de\s+aplicaci[oó]n\s*:\s*(\d{1,2}[/-]\d{1,2}[/-]\d{4})/i) || valueAfterLabel(lines, [
      /(?:fecha\s+(?:de\s+)?(?:operacion|aplicacion|pago|transferencia)|fecha)\s*[:\-]?\s*(.*)$/i,
    ]) || lines.find((line) => parseDate(line)) || ""
    const uniqueFolio = firstSpecificMatch(lines, /folio\s+[uú]nico\s*:\s*([A-Z0-9-]{8,120})/i)
    const reference = uniqueFolio || valueAfterLabel(lines, [
      /(?:referencia(?:\s+numerica)?|folio(?:\s+de\s+internet)?|numero\s+de\s+operacion)\s*[:\-]?\s*(.*)$/i,
    ])
    const trackingKey = valueAfterLabel(lines, [
      /(?:clave\s+de\s+rastreo|rastreo|codigo\s+de\s+seguimiento)\s*[:\-]?\s*(.*)$/i,
    ])
    const beneficiary = bbvaBeneficiary(lines)
    const concept = valueAfterLabel(lines, [
      /(?:concepto(?:\s+de\s+pago)?|motivo\s+de\s+pago|descripcion)\s*[:\-]?\s*(.*)$/i,
    ])
    const sourceAccount = firstSpecificMatch(lines, /cuenta\s+de\s+retiro\s*:\s*([A-Z0-9]+)/i)
    const destination = firstSpecificMatch(lines, /cuenta\s+de\s+dep[oó]sito\s*:\s*([A-Z0-9]+)/i) || valueAfterLabel(lines, [
      /(?:cuenta|clabe|tarjeta)\s+(?:de\s+)?destino\s*[:\-]?\s*(.*)$/i,
    ])
    const bankStatus = firstSpecificMatch(lines, /\bestado\s*:\s*([A-ZÁÉÍÓÚÑ ]+)/i)
    const sourceAccountMaterial = cleanText(sourceAccount).replace(/\D/g, "")
    const hasStrongAccount = /^[0-9]{10,18}$/.test(sourceAccountMaterial)

    const isBbva = lines.some((line) => /\bbbva\b/i.test(line))
    const issues = []
    if (!isBbva) issues.push("bank_not_identified")
    if (!parseDate(dateText)) issues.push("operation_date_missing")
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) issues.push("amount_missing_or_invalid")
    if (!currency) issues.push("currency_missing_or_invalid")
    if (!uniqueFolio) issues.push("bank_unique_folio_missing")
    if (!hasStrongAccount) issues.push("strong_bank_identity_missing")
    if (!beneficiary) issues.push("beneficiary_missing")
    if (normalizeForMatch(bankStatus) !== "operado") issues.push("bank_status_not_operated")

    const evidence = lines
      .filter((line) => /bbva|fecha|importe|monto|referencia|rastreo|beneficiario|concepto|destino/i.test(normalizeForMatch(line)))
      .slice(0, 12)
      .map(redactSensitiveText)

    const result = {
      parser_version: PARSER_VERSION,
      source_page: pageNumber,
      bank_code: isBbva ? "BBVA_MX" : null,
      bank_name: isBbva ? "BBVA" : "UNKNOWN",
      operation_date: parseDate(dateText),
      application_date: parseDate(dateText),
      amount_minor: amountMinor,
      currency,
      bank_reference: redactSensitiveText(reference).slice(0, 120) || null,
      bank_unique_folio: cleanText(uniqueFolio).slice(0, 120) || null,
      bank_status: cleanText(bankStatus).slice(0, 40) || null,
      tracking_key: redactSensitiveText(trackingKey).slice(0, 120) || null,
      beneficiary_name: redactSensitiveText(beneficiary).slice(0, 180) || null,
      concept: redactSensitiveText(concept).slice(0, 300) || null,
      payment_reason: redactSensitiveText(concept).slice(0, 300) || null,
      destination_masked: redactSensitiveText(destination).slice(0, 80) || null,
      destination_account_last4: cleanText(destination).replace(/\D/g, "").slice(-4) || null,
      evidence_excerpt: evidence,
      review_issues: issues,
      confidence: issues.length === 0 ? "high" : issues.length <= 2 ? "medium" : "low",
      source_filename: cleanText(options.fileName || options.source_filename).slice(0, 255) || null,
    }
    // Full accounts exist only as non-enumerable, ephemeral parser output so the
    // authenticated RPC can hash and discard them. Rendering/serialization stays masked.
    Object.defineProperties(result, {
      source_account: { value: cleanText(sourceAccount) || null, enumerable: false },
      destination_account: { value: cleanText(destination) || null, enumerable: false },
    })
    return Object.freeze(result)
  }

  function parseBbvaDocument(pages, options = {}) {
    const operations = (Array.isArray(pages) ? pages : [])
      .map((page, index) => parseBbvaPage({ ...page, pageNumber: page.pageNumber || page.page_number || index + 1 }, options))
    return Object.freeze({
      parser_version: PARSER_VERSION,
      page_count: operations.length,
      operations,
      review_required_count: operations.filter((operation) => operation.review_issues.length > 0).length,
    })
  }

  return Object.freeze({
    PARSER_VERSION,
    normalizeCurrency,
    parseMoneyToMinor,
    formatMinorForDisplay,
    linesFromTextItems,
    parseBbvaPage,
    parseBbvaDocument,
    redactSensitiveText,
  })
})
