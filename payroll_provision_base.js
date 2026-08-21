(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FluxPayrollProvisionBase = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CONTRACT_VERSION = 'payroll-provision-base-v1';
  const SHEET_NAME = 'OPERADORA TLACATECPAN';
  const REQUIRED_HEADERS = Object.freeze(['Sueldo', 'Sueldo Vacaciones']);
  const MAX_SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

  function asBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    return null;
  }
  function u16(bytes, offset) { return bytes[offset] | (bytes[offset + 1] << 8); }
  function u32(bytes, offset) { return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0; }
  function findEocd(bytes) {
    const min = Math.max(0, bytes.length - 65557);
    for (let offset = bytes.length - 22; offset >= min; offset -= 1) if (u32(bytes, offset) === 0x06054b50) return offset;
    return -1;
  }
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') throw new Error('PAYROLL_PROVISION_BASE_ZIP_INVALID');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(bytes) {
    const eocd = findEocd(bytes);
    if (eocd < 0) throw new Error('PAYROLL_PROVISION_BASE_ZIP_INVALID');
    const entryCount = u16(bytes, eocd + 10);
    const centralOffset = u32(bytes, eocd + 16);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const entries = new Map(); let cursor = centralOffset;
    for (let index = 0; index < entryCount; index += 1) {
      if (u32(bytes, cursor) !== 0x02014b50) throw new Error('PAYROLL_PROVISION_BASE_ZIP_INVALID');
      const method = u16(bytes, cursor + 10);
      const compressedSize = u32(bytes, cursor + 20);
      const uncompressedSize = u32(bytes, cursor + 24);
      const nameLength = u16(bytes, cursor + 28);
      const extraLength = u16(bytes, cursor + 30);
      const commentLength = u16(bytes, cursor + 32);
      const localOffset = u32(bytes, cursor + 42);
      const name = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
      cursor += 46 + nameLength + extraLength + commentLength;
      if (u32(bytes, localOffset) !== 0x04034b50) throw new Error('PAYROLL_PROVISION_BASE_ZIP_INVALID');
      const localNameLength = u16(bytes, localOffset + 26);
      const localExtraLength = u16(bytes, localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);
      let payload;
      if (method === 0) payload = compressed;
      else if (method === 8) payload = await inflateRaw(compressed);
      else throw new Error('PAYROLL_PROVISION_BASE_ZIP_INVALID');
      if (uncompressedSize && payload.byteLength !== uncompressedSize) throw new Error('PAYROLL_PROVISION_BASE_ZIP_INVALID');
      entries.set(name.replace(/^\//, ''), payload);
    }
    return entries;
  }
  function xmlText(bytes) { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
  function decodeXml(value) {
    return String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
      .replace(/&#(\d+);/g, function (_, c) { return String.fromCodePoint(Number(c)); })
      .replace(/&#x([0-9a-f]+);/gi, function (_, c) { return String.fromCodePoint(parseInt(c, 16)); });
  }
  function attr(tag, name) {
    const match = tag.match(new RegExp('(?:^|\\s)' + name.replace(':', '\\:') + '="([^"]*)"'));
    return match ? decodeXml(match[1]) : '';
  }
  function sharedStrings(xml) {
    if (!xml) return [];
    const output = []; const itemRe = /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g; let item;
    while ((item = itemRe.exec(xml))) {
      let text = ''; const textRe = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g; let part;
      while ((part = textRe.exec(item[1]))) text += decodeXml(part[1]);
      output.push(text);
    }
    return output;
  }
  function sheetTarget(entries, sheetName) {
    const workbook = xmlText(entries.get('xl/workbook.xml') || new Uint8Array());
    const rels = xmlText(entries.get('xl/_rels/workbook.xml.rels') || new Uint8Array());
    const sheetRe = /<(?:\w+:)?sheet\b[^>]*>/g; let sheet; let relId = '';
    while ((sheet = sheetRe.exec(workbook))) if (attr(sheet[0], 'name') === sheetName) { relId = attr(sheet[0], 'r:id') || attr(sheet[0], 'id'); break; }
    if (!relId) throw new Error('PAYROLL_PROVISION_BASE_CONTRACT_MISMATCH');
    const relRe = /<Relationship\b[^>]*>/g; let rel;
    while ((rel = relRe.exec(rels))) {
      if (attr(rel[0], 'Id') !== relId) continue;
      const target = attr(rel[0], 'Target').replace(/^\//, '');
      return target.startsWith('xl/') ? target : 'xl/' + target.replace(/^\.\//, '');
    }
    throw new Error('PAYROLL_PROVISION_BASE_CONTRACT_MISMATCH');
  }
  function parseCells(xml, shared) {
    const cells = new Map();
    const re = /<(?:\w+:)?c\b([^>]*)\/>|<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/g; let match;
    while ((match = re.exec(xml))) {
      const attrs = match[1] || match[2] || ''; const ref = attrs.match(/(?:^|\s)r="([A-Z]+\d+)"/)?.[1]; if (!ref) continue;
      const type = attrs.match(/(?:^|\s)t="([^"]+)"/)?.[1] || ''; const body = match[3] || '';
      const valueNode = body.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/);
      const textNode = body.match(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/);
      let value = valueNode ? decodeXml(valueNode[1]) : (textNode ? decodeXml(textNode[1]) : '');
      if (type === 's' && value !== '') value = shared[Number(value)] || '';
      cells.set(ref, value);
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
  function spreadsheetMinor(value) {
    const raw = String(value == null ? '' : value).trim().replace(/,/g, '');
    if (raw === '') return 0;
    if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
    const number = Number(raw);
    if (!Number.isFinite(number) || number < 0) return null;
    const cents = Math.round(number * 100);
    if (!Number.isSafeInteger(cents) || Math.abs(number * 100 - cents) > 1e-6) return null;
    return cents;
  }

  async function parseProvisionBaseXlsx(input) {
    const bytes = asBytes(input);
    if (!bytes || bytes.byteLength < 22) return { contractVersion: CONTRACT_VERSION, valid: false, baseAmountMinor: null, rowCount: 0, issues: ['PAYROLL_PROVISION_BASE_ZIP_INVALID'] };
    try {
      const entries = await unzip(bytes);
      const target = sheetTarget(entries, SHEET_NAME);
      const sheet = xmlText(entries.get(target) || new Uint8Array());
      const shared = sharedStrings(entries.has('xl/sharedStrings.xml') ? xmlText(entries.get('xl/sharedStrings.xml')) : '');
      const cells = parseCells(sheet, shared);
      const headerMap = {};
      cells.forEach(function (value, ref) {
        if (!ref.endsWith('5')) return;
        const label = String(value || '').trim();
        if (REQUIRED_HEADERS.includes(label)) headerMap[label] = columnNumber(ref);
      });
      if (REQUIRED_HEADERS.some(function (header) { return !headerMap[header]; })) {
        return { contractVersion: CONTRACT_VERSION, valid: false, baseAmountMinor: null, rowCount: 0, issues: ['PAYROLL_PROVISION_BASE_HEADERS_REQUIRED'] };
      }
      let total = 0; let rowCount = 0;
      for (let row = 6; row <= 1000; row += 1) {
        const salaryRaw = cells.get(columnLetters(headerMap['Sueldo']) + row);
        const vacationRaw = cells.get(columnLetters(headerMap['Sueldo Vacaciones']) + row);
        if (String(salaryRaw ?? '').trim() === '' && String(vacationRaw ?? '').trim() === '') continue;
        const salary = spreadsheetMinor(salaryRaw); const vacation = spreadsheetMinor(vacationRaw);
        if (salary === null || vacation === null || !Number.isSafeInteger(total + salary + vacation)) {
          return { contractVersion: CONTRACT_VERSION, valid: false, baseAmountMinor: null, rowCount: 0, issues: ['PAYROLL_PROVISION_BASE_ROW_INVALID'] };
        }
        total += salary + vacation; rowCount += 1;
      }
      if (!rowCount || total <= 0) return { contractVersion: CONTRACT_VERSION, valid: false, baseAmountMinor: null, rowCount: 0, issues: ['PAYROLL_PROVISION_BASE_EMPTY'] };
      return { contractVersion: CONTRACT_VERSION, valid: true, baseAmountMinor: total, rowCount, issues: [] };
    } catch (error) {
      const code = /^PAYROLL_PROVISION_BASE_[A-Z0-9_]+$/.test(String(error?.message || '')) ? error.message : 'PAYROLL_PROVISION_BASE_ZIP_INVALID';
      return { contractVersion: CONTRACT_VERSION, valid: false, baseAmountMinor: null, rowCount: 0, issues: [code] };
    }
  }

  return Object.freeze({ CONTRACT_VERSION, SHEET_NAME, REQUIRED_HEADERS, parseProvisionBaseXlsx });
});
