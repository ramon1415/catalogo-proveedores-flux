(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FluxPayrollRealFormats = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CONTRACT_VERSION = 'payroll-real-physical-v1';
  const COVER_CONTRACT_VERSION = 'operadora-tlacatecpan-cover-v1';
  const SAME_BANK_CONTRACT_VERSION = 'bbva-payroll-nomina108-v1';
  const TOKA_CFDI_CONTRACT_VERSION = 'toka-cfdi-vales-v1';
  const COVER_SHEET_NAME = 'OPERADORA TLACATECPAN';
  const REQUIRED_COVER_HEADERS = Object.freeze([
    'RFC','CURP','Nombre completo','Banco','Cuenta banco','CLABE',
    'Vales De Despensa','Neto a pagar','Neto en efectivo (sin vales)'
  ]);
  const MAX_SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

  const ISSUE = Object.freeze({
    COVER_ZIP_INVALID: 'PAYROLL_REAL_COVER_ZIP_INVALID',
    COVER_CONTRACT_MISMATCH: 'PAYROLL_REAL_COVER_CONTRACT_MISMATCH',
    COVER_ROW_INVALID: 'PAYROLL_REAL_COVER_ROW_INVALID',
    SAME_BANK_BYTE_CONTRACT_INVALID: 'PAYROLL_REAL_SAME_BANK_108_INVALID',
    TOKA_CFDI_INVALID: 'PAYROLL_REAL_TOKA_CFDI_INVALID',
    TOKA_CFDI_TOTAL_MISMATCH: 'PAYROLL_REAL_TOKA_CFDI_TOTAL_MISMATCH',
    EMPLOYEE_NOT_FOUND: 'PAYROLL_REAL_EMPLOYEE_NOT_FOUND',
    EMPLOYEE_MATCH_AMBIGUOUS: 'PAYROLL_REAL_EMPLOYEE_MATCH_AMBIGUOUS',
    EMPLOYEE_TOTAL_MISMATCH: 'PAYROLL_REAL_EMPLOYEE_TOTAL_MISMATCH',
    SOURCE_ACCOUNT_MISMATCH: 'PAYROLL_REAL_SOURCE_ACCOUNT_MISMATCH',
    TOKA_FUNDING_INVALID: 'PAYROLL_REAL_TOKA_FUNDING_INVALID',
    CHANNEL_TOTAL_INVALID: 'PAYROLL_REAL_CHANNEL_TOTAL_INVALID'
  });
  const WARNING = Object.freeze({
    SOURCE_NAME_DIFFERENCE: 'PAYROLL_SOURCE_NAME_DIFFERENCE',
    TOKA_FUNDING_VARIANCE_REVIEW_REQUIRED: 'PAYROLL_TOKA_FUNDING_VARIANCE_REVIEW_REQUIRED'
  });

  function issue(code, source, row, field) {
    const out = { code, severity: 'blocking' };
    if (source) out.source = source;
    if (Number.isInteger(row) && row > 0) out.row = row;
    if (field) out.field = field;
    return out;
  }
  function warning(code, source, row, extra) {
    const out = { code, severity: 'warning' };
    if (source) out.source = source;
    if (Number.isInteger(row) && row > 0) out.row = row;
    return Object.assign(out, extra || {});
  }
  function normalizeIdentifier(value) {
    return String(value == null ? '' : value).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  function normalizeAccount(value) {
    const digits = String(value == null ? '' : value).replace(/\D/g, '');
    return /^0+$/.test(digits) ? '' : digits;
  }
  function normalizeName(value) {
    return String(value == null ? '' : value)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  }
  function nameTokens(value) {
    return new Set(normalizeName(value).split(' ').filter(function (x) { return x.length > 2; }));
  }
  function namesRoughlyAgree(a, b) {
    const aa = nameTokens(a); const bb = nameTokens(b);
    if (!aa.size || !bb.size) return true;
    let overlap = 0;
    aa.forEach(function (token) { if (bb.has(token)) overlap += 1; });
    return overlap >= Math.min(2, aa.size, bb.size);
  }
  function minor(value) {
    const raw = String(value == null ? '' : value).trim().replace(/,/g, '');
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
    const parts = raw.split('.');
    const result = BigInt(parts[0]) * 100n + BigInt((parts[1] || '').padEnd(2, '0'));
    if (result < 0 || result > MAX_SAFE_MINOR) return null;
    return Number(result);
  }
  function spreadsheetMinor(value) {
    const raw = String(value == null ? '' : value).trim().replace(/,/g, '');
    if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
    const number = Number(raw);
    if (!Number.isFinite(number) || number < 0) return null;
    const cents = Math.round(number * 100);
    if (!Number.isSafeInteger(cents) || Math.abs(number * 100 - cents) > 1e-6) return null;
    return cents;
  }

  function asBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    return null;
  }
  function u16(bytes, offset) { return bytes[offset] | (bytes[offset + 1] << 8); }
  function u32(bytes, offset) {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  }
  function findEocd(bytes) {
    const min = Math.max(0, bytes.length - 65557);
    for (let offset = bytes.length - 22; offset >= min; offset -= 1) if (u32(bytes, offset) === 0x06054b50) return offset;
    return -1;
  }
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') throw new Error(ISSUE.COVER_ZIP_INVALID);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(bytes) {
    const eocd = findEocd(bytes);
    if (eocd < 0) throw new Error(ISSUE.COVER_ZIP_INVALID);
    const entryCount = u16(bytes, eocd + 10);
    const centralOffset = u32(bytes, eocd + 16);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const entries = new Map(); let cursor = centralOffset;
    for (let index = 0; index < entryCount; index += 1) {
      if (u32(bytes, cursor) !== 0x02014b50) throw new Error(ISSUE.COVER_ZIP_INVALID);
      const method = u16(bytes, cursor + 10);
      const compressedSize = u32(bytes, cursor + 20);
      const uncompressedSize = u32(bytes, cursor + 24);
      const nameLength = u16(bytes, cursor + 28);
      const extraLength = u16(bytes, cursor + 30);
      const commentLength = u16(bytes, cursor + 32);
      const localOffset = u32(bytes, cursor + 42);
      const name = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
      cursor += 46 + nameLength + extraLength + commentLength;
      if (u32(bytes, localOffset) !== 0x04034b50) throw new Error(ISSUE.COVER_ZIP_INVALID);
      const localNameLength = u16(bytes, localOffset + 26);
      const localExtraLength = u16(bytes, localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);
      let payload;
      if (method === 0) payload = compressed;
      else if (method === 8) payload = await inflateRaw(compressed);
      else throw new Error(ISSUE.COVER_ZIP_INVALID);
      if (uncompressedSize && payload.byteLength !== uncompressedSize) throw new Error(ISSUE.COVER_ZIP_INVALID);
      entries.set(name.replace(/^\//, ''), payload);
    }
    return entries;
  }
  function xmlText(bytes) {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  }
  function decodeXml(value) {
    return String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
      .replace(/&#(\d+);/g, function (_, c) { return String.fromCodePoint(Number(c)); })
      .replace(/&#x([0-9a-f]+);/gi, function (_, c) { return String.fromCodePoint(parseInt(c, 16)); });
  }
  function attr(tag, name) {
    const m = tag.match(new RegExp('(?:^|\\s)' + name.replace(':', '\\:') + '="([^"]*)"'));
    return m ? decodeXml(m[1]) : '';
  }
  function sharedStrings(xml) {
    if (!xml) return [];
    const out = []; const itemRe = /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g; let item;
    while ((item = itemRe.exec(xml))) {
      let text = ''; const textRe = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g; let part;
      while ((part = textRe.exec(item[1]))) text += decodeXml(part[1]);
      out.push(text);
    }
    return out;
  }
  function sheetTarget(entries, sheetName) {
    const workbook = xmlText(entries.get('xl/workbook.xml') || new Uint8Array());
    const rels = xmlText(entries.get('xl/_rels/workbook.xml.rels') || new Uint8Array());
    const sheetRe = /<(?:\w+:)?sheet\b[^>]*>/g; let sheet; let relId = '';
    while ((sheet = sheetRe.exec(workbook))) if (attr(sheet[0], 'name') === sheetName) { relId = attr(sheet[0], 'r:id') || attr(sheet[0], 'id'); break; }
    if (!relId) throw new Error(ISSUE.COVER_CONTRACT_MISMATCH);
    const relRe = /<Relationship\b[^>]*>/g; let rel;
    while ((rel = relRe.exec(rels))) {
      if (attr(rel[0], 'Id') !== relId) continue;
      const target = attr(rel[0], 'Target').replace(/^\//, '');
      return target.startsWith('xl/') ? target : 'xl/' + target.replace(/^\.\//, '');
    }
    throw new Error(ISSUE.COVER_CONTRACT_MISMATCH);
  }
  function parseCells(xml, shared) {
    const cells = new Map();
    const re = /<(?:\w+:)?c\b([^>]*)\/>|<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/g; let m;
    while ((m = re.exec(xml))) {
      const attrs = m[1] || m[2] || ''; const refM = attrs.match(/(?:^|\s)r="([A-Z]+\d+)"/); if (!refM) continue;
      const typeM = attrs.match(/(?:^|\s)t="([^"]+)"/); const type = typeM ? typeM[1] : ''; const body = m[3] || '';
      const vM = body.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/);
      const tM = body.match(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/);
      let value = vM ? decodeXml(vM[1]) : (tM ? decodeXml(tM[1]) : '');
      if (type === 's' && value !== '') value = shared[Number(value)] || '';
      cells.set(refM[1], value);
    }
    return cells;
  }
  function columnNumber(ref) {
    const letters = String(ref).match(/^[A-Z]+/)?.[0] || ''; let out = 0;
    for (const c of letters) out = out * 26 + c.charCodeAt(0) - 64;
    return out;
  }
  function columnLetters(number) {
    let n = number; let out = '';
    while (n > 0) { n -= 1; out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26); }
    return out;
  }

  async function parseCoverXlsx(input) {
    const bytes = asBytes(input);
    if (!bytes || bytes.byteLength < 22) return { contractVersion: COVER_CONTRACT_VERSION, valid: false, people: [], issues: [issue(ISSUE.COVER_ZIP_INVALID, 'caratula')] };
    try {
      const entries = await unzip(bytes);
      const target = sheetTarget(entries, COVER_SHEET_NAME);
      const sheet = xmlText(entries.get(target) || new Uint8Array());
      const shared = sharedStrings(entries.has('xl/sharedStrings.xml') ? xmlText(entries.get('xl/sharedStrings.xml')) : '');
      const cells = parseCells(sheet, shared);
      const headerMap = {};
      cells.forEach(function (value, ref) {
        if (!ref.endsWith('5')) return;
        const label = String(value || '').trim();
        if (REQUIRED_COVER_HEADERS.includes(label)) headerMap[label] = columnNumber(ref);
      });
      if (REQUIRED_COVER_HEADERS.some(function (h) { return !headerMap[h]; })) {
        return { contractVersion: COVER_CONTRACT_VERSION, valid: false, people: [], issues: [issue(ISSUE.COVER_CONTRACT_MISMATCH, 'caratula', 5, 'headers')] };
      }
      function value(row, header) { return cells.get(columnLetters(headerMap[header]) + row); }
      const people = []; const issues = []; let netTotal = 0; let cashTotal = 0; let voucherTotal = 0;
      for (let row = 6; row <= 1000; row += 1) {
        const employeeName = String(value(row, 'Nombre completo') || '').trim();
        const rfcRaw = value(row, 'RFC'); const curpRaw = value(row, 'CURP');
        if (!employeeName && !rfcRaw && !curpRaw) continue;
        const rfc = normalizeIdentifier(rfcRaw); const curp = normalizeIdentifier(curpRaw);
        const bankName = String(value(row, 'Banco') || '').trim(); const account = normalizeAccount(value(row, 'Cuenta banco'));
        const clabe = normalizeAccount(value(row, 'CLABE'));
        const vouchers = spreadsheetMinor(value(row, 'Vales De Despensa')); const net = spreadsheetMinor(value(row, 'Neto a pagar')); const cash = spreadsheetMinor(value(row, 'Neto en efectivo (sin vales)'));
        if (!employeeName || (!rfc && !curp) || [vouchers, net, cash].some(function (x) { return x === null; })) {
          issues.push(issue(ISSUE.COVER_ROW_INVALID, 'caratula', row)); continue;
        }
        if (net < 0 || cash < 0 || vouchers < 0 || net !== cash + vouchers) {
          issues.push(issue(ISSUE.EMPLOYEE_TOTAL_MISMATCH, 'caratula', row)); continue;
        }
        if (cash > 0 && !account && !clabe) { issues.push(issue(ISSUE.COVER_ROW_INVALID, 'caratula', row, 'destination')); continue; }
        if (clabe && !/^\d{18}$/.test(clabe)) { issues.push(issue(ISSUE.COVER_ROW_INVALID, 'caratula', row, 'CLABE')); continue; }
        people.push({ sourceRow: row, employeeName, normalizedName: normalizeName(employeeName), rfc, curp, nss: '', bankName, account, clabe,
          netAmountMinor: net, coverCashAmountMinor: cash, coverVouchersAmountMinor: vouchers,
          bankAmountMinor: 0, speiAmountMinor: 0, vouchersAmountMinor: 0 });
        netTotal += net; cashTotal += cash; voucherTotal += vouchers;
        if (![netTotal,cashTotal,voucherTotal].every(Number.isSafeInteger)) issues.push(issue(ISSUE.CHANNEL_TOTAL_INVALID, 'caratula'));
      }
      if (!people.length) issues.push(issue(ISSUE.COVER_CONTRACT_MISMATCH, 'caratula'));
      return { contractVersion: COVER_CONTRACT_VERSION, sheetName: COVER_SHEET_NAME, valid: issues.length === 0,
        people: issues.length ? [] : people, totals: issues.length ? null : { netAmountMinor: netTotal, cashAmountMinor: cashTotal, vouchersAmountMinor: voucherTotal }, issues };
    } catch (error) {
      const code = error && Object.values(ISSUE).includes(error.message) ? error.message : ISSUE.COVER_ZIP_INVALID;
      return { contractVersion: COVER_CONTRACT_VERSION, valid: false, people: [], issues: [issue(code, 'caratula')] };
    }
  }

  function parseSameBank108(input) {
    const bytes = asBytes(input); const issues = []; const records = [];
    if (!bytes || !bytes.length || bytes.length % 110 !== 0) return { contractVersion: SAME_BANK_CONTRACT_VERSION, valid: false, records: [], issues: [issue(ISSUE.SAME_BANK_BYTE_CONTRACT_INVALID, 'layout_mismo_banco', null, 'length')] };
    const count = bytes.length / 110;
    for (let row = 1; row <= count; row += 1) {
      const offset = (row - 1) * 110;
      if (bytes[offset + 108] !== 0x0d || bytes[offset + 109] !== 0x0a) { issues.push(issue(ISSUE.SAME_BANK_BYTE_CONTRACT_INVALID, 'layout_mismo_banco', row, 'crlf')); continue; }
      let line = '';
      for (let i=0;i<108;i+=1) { const b=bytes[offset+i]; if (b<0x20 || b>0x7e) { issues.push(issue(ISSUE.SAME_BANK_BYTE_CONTRACT_INVALID,'layout_mismo_banco',row,'encoding')); line=''; break; } line += String.fromCharCode(b); }
      if (!line) continue;
      const consecutive=line.slice(0,9), rfcField=line.slice(9,25).trim(), type=line.slice(25,27), accountField=line.slice(27,47), amountField=line.slice(47,62), employeeName=line.slice(62,102).trim(), bank=line.slice(102,105), plaza=line.slice(105,108);
      const account = normalizeAccount(accountField); const amountMinor = /^\d{15}$/.test(amountField) ? Number(BigInt(amountField)) : null;
      if (!/^\d{9}$/.test(consecutive) || type !== '99' || !account || amountMinor === null || amountMinor <= 0 || !employeeName || bank + plaza !== '001001' || (rfcField && !/^[A-Z0-9 ]+$/.test(rfcField))) {
        issues.push(issue(ISSUE.SAME_BANK_BYTE_CONTRACT_INVALID,'layout_mismo_banco',row,'record')); continue;
      }
      records.push({ sourceRow: row, consecutive, rfc: normalizeIdentifier(rfcField), account, amountMinor, employeeName, normalizedName: normalizeName(employeeName), bankCode: bank, plazaCode: plaza, type });
    }
    const total = records.reduce(function (s,r) { return s+r.amountMinor; },0);
    return { contractVersion: SAME_BANK_CONTRACT_VERSION, valid: issues.length===0 && records.length>0, recordCount: issues.length?0:records.length, totalAmountMinor: issues.length?null:total, records: issues.length?[]:records, issues };
  }

  function parseTokaCfdi(input) {
    let xml=''; try { xml = typeof input === 'string' ? input : xmlText(asBytes(input) || new Uint8Array()); } catch (_) { return { contractVersion:TOKA_CFDI_CONTRACT_VERSION,valid:false,records:[],issues:[issue(ISSUE.TOKA_CFDI_INVALID,'cfdi_vales')]}; }
    const comp = xml.match(/<(?:\w+:)?Comprobante\b[^>]*>/)?.[0] || '';
    const issuer = xml.match(/<(?:\w+:)?Emisor\b[^>]*>/)?.[0] || '';
    const valesMatch = xml.match(/<(?:\w+:)?ValesDeDespensa\b[^>]*>([\s\S]*?)<\/(?:\w+:)?ValesDeDespensa>/);
    if (!comp || !issuer || !valesMatch || attr(comp,'Version')!=='4.0' || attr(comp,'Moneda')!=='MXN' || attr(issuer,'Rfc')!=='TIN090211JC9') {
      return { contractVersion:TOKA_CFDI_CONTRACT_VERSION,valid:false,records:[],issues:[issue(ISSUE.TOKA_CFDI_INVALID,'cfdi_vales')]};
    }
    const valesOpen = xml.match(/<(?:\w+:)?ValesDeDespensa\b[^>]*>/)?.[0] || '';
    const benefitMinor = minor(attr(valesOpen,'total')); const feeMinor = minor(attr(comp,'SubTotal')); const providerChargeMinor = minor(attr(comp,'Total'));
    const taxTags = Array.from(xml.matchAll(/<(?:\w+:)?Impuestos\b[^>]*TotalImpuestosTrasladados="[^"]+"[^>]*>/g));
    const taxMinor = taxTags.length ? minor(attr(taxTags[taxTags.length-1][0],'TotalImpuestosTrasladados')) : 0;
    if ([benefitMinor,feeMinor,providerChargeMinor,taxMinor].some(function(x){return x===null;}) || feeMinor + taxMinor !== providerChargeMinor) {
      return { contractVersion:TOKA_CFDI_CONTRACT_VERSION,valid:false,records:[],issues:[issue(ISSUE.TOKA_CFDI_TOTAL_MISMATCH,'cfdi_vales')]};
    }
    const records=[]; const issues=[]; const tags=Array.from(valesMatch[1].matchAll(/<(?:\w+:)?Concepto\b[^>]*\/>/g)).map(function(m){return m[0];});
    let sum=0;
    tags.forEach(function(tag,index){ const rfc=normalizeIdentifier(attr(tag,'rfc')),curp=normalizeIdentifier(attr(tag,'curp')),nss=normalizeIdentifier(attr(tag,'numSeguridadSocial')),employeeName=String(attr(tag,'nombre')||'').trim(),amountMinor=minor(attr(tag,'importe'));
      if ((!rfc && !curp) || amountMinor===null || amountMinor<0) { issues.push(issue(ISSUE.TOKA_CFDI_INVALID,'cfdi_vales',index+1)); return; }
      sum += amountMinor; records.push({sourceRow:index+1,rfc,curp,nss,employeeName,amountMinor}); });
    if (!records.length || sum!==benefitMinor) issues.push(issue(ISSUE.TOKA_CFDI_TOTAL_MISMATCH,'cfdi_vales'));
    return { contractVersion:TOKA_CFDI_CONTRACT_VERSION,valid:issues.length===0,recordCount:issues.length?0:records.length,benefitAmountMinor:benefitMinor,feeAmountMinor:feeMinor,taxAmountMinor:taxMinor,providerChargeAmountMinor:providerChargeMinor,expectedFundingAmountMinor:benefitMinor+providerChargeMinor,records:issues.length?[]:records,issues };
  }

  function reconcilePackage(input) {
    const cover=input && input.cover, sameBank=input && input.sameBank, spei=input && input.spei, tokaCfdi=input && input.tokaCfdi, tokaFunding=input && input.tokaFunding;
    const sourceAccount=normalizeAccount(input && input.sourceAccount); const issues=[]; const warnings=[];
    [cover,sameBank,spei,tokaCfdi,tokaFunding].forEach(function(x){ if(x && Array.isArray(x.issues)) issues.push.apply(issues,x.issues); });
    if (!cover || !cover.valid || !Array.isArray(cover.people)) issues.push(issue(ISSUE.COVER_CONTRACT_MISMATCH,'caratula'));
    if (!sameBank || !sameBank.valid) issues.push(issue(ISSUE.SAME_BANK_BYTE_CONTRACT_INVALID,'layout_mismo_banco'));
    if (!spei || !Array.isArray(spei.records) || (spei.issues||[]).length) issues.push(issue(ISSUE.CHANNEL_TOTAL_INVALID,'layout_spei'));
    if (!tokaCfdi || !tokaCfdi.valid) issues.push(issue(ISSUE.TOKA_CFDI_INVALID,'cfdi_vales'));
    if (!tokaFunding || !Array.isArray(tokaFunding.records) || tokaFunding.records.length!==1 || (tokaFunding.issues||[]).length) issues.push(issue(ISSUE.TOKA_FUNDING_INVALID,'layout_toka'));
    if (issues.length) return {contractVersion:CONTRACT_VERSION,valid:false,people:[],channels:[],issues,warnings};
    const people=cover.people.map(function(p){return Object.assign({},p,{bankAmountMinor:0,speiAmountMinor:0,vouchersAmountMinor:0});});
    function matchBank(records, channel) {
      records.forEach(function(rec){ const candidates=people.filter(function(p){ const dest=channel==='banco'?p.account:p.clabe; return dest && dest===(channel==='banco'?rec.account:rec.clabe) && p.coverCashAmountMinor===rec.amountMinor; });
        if(candidates.length===0){issues.push(issue(ISSUE.EMPLOYEE_NOT_FOUND,channel==='banco'?'layout_mismo_banco':'layout_spei',rec.sourceRow));return;}
        if(candidates.length>1){issues.push(issue(ISSUE.EMPLOYEE_MATCH_AMBIGUOUS,channel==='banco'?'layout_mismo_banco':'layout_spei',rec.sourceRow));return;}
        const person=candidates[0]; if(channel==='banco') person.bankAmountMinor+=rec.amountMinor; else person.speiAmountMinor+=rec.amountMinor;
        if(rec.employeeName && !namesRoughlyAgree(person.employeeName,rec.employeeName)) warnings.push(warning(WARNING.SOURCE_NAME_DIFFERENCE,channel==='banco'?'layout_mismo_banco':'layout_spei',rec.sourceRow)); });
    }
    matchBank(sameBank.records,'banco'); matchBank(spei.records,'spei');
    tokaCfdi.records.forEach(function(rec){ let candidates=[]; if(rec.rfc) candidates=people.filter(function(p){return p.rfc===rec.rfc;}); if(!candidates.length&&rec.curp)candidates=people.filter(function(p){return p.curp===rec.curp;});
      if(candidates.length===0){issues.push(issue(ISSUE.EMPLOYEE_NOT_FOUND,'cfdi_vales',rec.sourceRow));return;} if(candidates.length>1){issues.push(issue(ISSUE.EMPLOYEE_MATCH_AMBIGUOUS,'cfdi_vales',rec.sourceRow));return;} candidates[0].vouchersAmountMinor+=rec.amountMinor; });
    people.forEach(function(p){ if(p.bankAmountMinor>0&&p.speiAmountMinor>0) issues.push(issue(ISSUE.EMPLOYEE_TOTAL_MISMATCH,'person',p.sourceRow,'dual_bank_rail')); if(p.bankAmountMinor+p.speiAmountMinor!==p.coverCashAmountMinor||p.vouchersAmountMinor!==p.coverVouchersAmountMinor||p.bankAmountMinor+p.speiAmountMinor+p.vouchersAmountMinor!==p.netAmountMinor) issues.push(issue(ISSUE.EMPLOYEE_TOTAL_MISMATCH,'person',p.sourceRow)); });
    const allSourceAccounts=[]; (spei.records||[]).forEach(function(r){allSourceAccounts.push(normalizeAccount(r.sourceAccount));}); (tokaFunding.records||[]).forEach(function(r){allSourceAccounts.push(normalizeAccount(r.sourceAccount));});
    if(!sourceAccount||allSourceAccounts.some(function(v){return !v||v!==sourceAccount;})) issues.push(issue(ISSUE.SOURCE_ACCOUNT_MISMATCH,'request'));
    const funding=tokaFunding.records[0]; if(!funding || normalizeName(funding.employeeName).indexOf('TOKA INTERNACIONAL')<0) issues.push(issue(ISSUE.TOKA_FUNDING_INVALID,'layout_toka'));
    const bankTotal=people.reduce(function(s,p){return s+p.bankAmountMinor;},0),speiTotal=people.reduce(function(s,p){return s+p.speiAmountMinor;},0),benefitTotal=people.reduce(function(s,p){return s+p.vouchersAmountMinor;},0);
    if(bankTotal!==sameBank.totalAmountMinor||speiTotal!==spei.records.reduce(function(s,r){return s+r.amountMinor;},0)||benefitTotal!==tokaCfdi.benefitAmountMinor) issues.push(issue(ISSUE.CHANNEL_TOTAL_INVALID,'channels'));
    const actualFunding=funding ? funding.amountMinor : 0, expectedFunding=tokaCfdi.expectedFundingAmountMinor, variance=actualFunding-expectedFunding;
    if(variance!==0) warnings.push(warning(WARNING.TOKA_FUNDING_VARIANCE_REVIEW_REQUIRED,'layout_toka',1,{varianceAmountMinor:variance,expectedFundingAmountMinor:expectedFunding,actualFundingAmountMinor:actualFunding}));
    const employeeNet=people.reduce(function(s,p){return s+p.netAmountMinor;},0),treasuryTotal=bankTotal+speiTotal+actualFunding;
    return {contractVersion:CONTRACT_VERSION,valid:issues.length===0,financeReviewRequired:variance!==0,people:issues.length?[]:people,
      channels:issues.length?[]:[{channel:'banco',amountMinor:bankTotal},{channel:'spei',amountMinor:speiTotal},{channel:'vales',amountMinor:actualFunding,benefitAmountMinor:benefitTotal,feeAmountMinor:tokaCfdi.feeAmountMinor,taxAmountMinor:tokaCfdi.taxAmountMinor,expectedFundingAmountMinor:expectedFunding,fundingVarianceMinor:variance}],
      employeeNetTotalMinor:employeeNet,treasuryRequestAmountMinor:treasuryTotal,issues,warnings};
  }

  return Object.freeze({CONTRACT_VERSION,COVER_CONTRACT_VERSION,SAME_BANK_CONTRACT_VERSION,TOKA_CFDI_CONTRACT_VERSION,COVER_SHEET_NAME,REQUIRED_COVER_HEADERS,ISSUE,WARNING,parseCoverXlsx,parseSameBank108,parseTokaCfdi,reconcilePackage,normalizeAccount,normalizeIdentifier,normalizeName});
});
