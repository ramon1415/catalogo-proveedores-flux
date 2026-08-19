(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FluxPayrollCoverQa = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CONTRACT_VERSION = 'flux-synthetic-cover-qa-v1';
  const FIXTURE_SHA256 = '1c50510376ef71dbf4f3c5087a74140860136cadafe49f896f95f9ce8768fe94';
  const SHEET_NAME = 'OPERADORA TLACATECPAN';
  const EXPECTED_HEADERS = Object.freeze([
    'ID_QA','EMPLEADO','RFC','CURP','NSS','BANCO','CUENTA','CLABE',
    'NETO','MISMO_BANCO','SPEI','VALES','TOTAL_CONTROL','VALIDACIÓN','CANAL_PRINCIPAL'
  ]);

  const ISSUE = Object.freeze({
    ZIP_INVALID: 'PAYROLL_QA_COVER_ZIP_INVALID',
    XML_INVALID: 'PAYROLL_QA_COVER_XML_INVALID',
    CONTRACT_MISMATCH: 'PAYROLL_QA_COVER_CONTRACT_MISMATCH',
    ROW_INVALID: 'PAYROLL_QA_COVER_ROW_INVALID',
    TOTAL_MISMATCH: 'PAYROLL_QA_COVER_TOTAL_MISMATCH'
  });

  function asBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    return null;
  }

  function u16(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
  }

  function u32(bytes, offset) {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  }

  function findEocd(bytes) {
    const min = Math.max(0, bytes.length - 65557);
    for (let offset = bytes.length - 22; offset >= min; offset -= 1) {
      if (u32(bytes, offset) === 0x06054b50) return offset;
    }
    return -1;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') throw new Error(ISSUE.ZIP_INVALID);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(bytes) {
    const eocd = findEocd(bytes);
    if (eocd < 0) throw new Error(ISSUE.ZIP_INVALID);
    const entryCount = u16(bytes, eocd + 10);
    const centralOffset = u32(bytes, eocd + 16);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const entries = new Map();
    let cursor = centralOffset;

    for (let index = 0; index < entryCount; index += 1) {
      if (u32(bytes, cursor) !== 0x02014b50) throw new Error(ISSUE.ZIP_INVALID);
      const method = u16(bytes, cursor + 10);
      const compressedSize = u32(bytes, cursor + 20);
      const uncompressedSize = u32(bytes, cursor + 24);
      const nameLength = u16(bytes, cursor + 28);
      const extraLength = u16(bytes, cursor + 30);
      const commentLength = u16(bytes, cursor + 32);
      const localOffset = u32(bytes, cursor + 42);
      const name = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
      cursor += 46 + nameLength + extraLength + commentLength;

      if (u32(bytes, localOffset) !== 0x04034b50) throw new Error(ISSUE.ZIP_INVALID);
      const localNameLength = u16(bytes, localOffset + 26);
      const localExtraLength = u16(bytes, localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);
      let payload;
      if (method === 0) payload = compressed;
      else if (method === 8) payload = await inflateRaw(compressed);
      else throw new Error(ISSUE.ZIP_INVALID);
      if (uncompressedSize && payload.byteLength !== uncompressedSize) throw new Error(ISSUE.ZIP_INVALID);
      entries.set(name.replace(/^\//, ''), payload);
    }
    return entries;
  }

  function xmlText(bytes) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    } catch (_) {
      throw new Error(ISSUE.XML_INVALID);
    }
  }

  function decodeXml(value) {
    return String(value || '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
      .replace(/&#(\d+);/g, function (_, code) { return String.fromCodePoint(Number(code)); })
      .replace(/&#x([0-9a-f]+);/gi, function (_, code) { return String.fromCodePoint(parseInt(code, 16)); });
  }

  function attr(tag, name) {
    const match = tag.match(new RegExp('(?:^|\\s)' + name.replace(':', '\\:') + '="([^"]*)"'));
    return match ? decodeXml(match[1]) : '';
  }

  function sharedStrings(xml) {
    if (!xml) return [];
    const out = [];
    const itemRe = /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g;
    let item;
    while ((item = itemRe.exec(xml))) {
      let text = '';
      const textRe = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g;
      let part;
      while ((part = textRe.exec(item[1]))) text += decodeXml(part[1]);
      out.push(text);
    }
    return out;
  }

  function sheetTarget(entries, sheetName) {
    const workbook = xmlText(entries.get('xl/workbook.xml') || new Uint8Array());
    const rels = xmlText(entries.get('xl/_rels/workbook.xml.rels') || new Uint8Array());
    const sheetRe = /<(?:\w+:)?sheet\b[^>]*>/g;
    let sheet;
    let relId = '';
    while ((sheet = sheetRe.exec(workbook))) {
      if (attr(sheet[0], 'name') === sheetName) {
        relId = attr(sheet[0], 'r:id') || attr(sheet[0], 'id');
        break;
      }
    }
    if (!relId) throw new Error(ISSUE.CONTRACT_MISMATCH);
    const relRe = /<Relationship\b[^>]*>/g;
    let rel;
    while ((rel = relRe.exec(rels))) {
      if (attr(rel[0], 'Id') !== relId) continue;
      const target = attr(rel[0], 'Target').replace(/^\//, '');
      return target.startsWith('xl/') ? target : 'xl/' + target.replace(/^\.\//, '');
    }
    throw new Error(ISSUE.CONTRACT_MISMATCH);
  }

  function parseCells(xml, shared) {
    const cells = new Map();
    const cellRe = /<(?:\w+:)?c\b([^>]*)\/>|<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/g;
    let match;
    while ((match = cellRe.exec(xml))) {
      const attrs = match[1] || match[2] || '';
      const refMatch = attrs.match(/(?:^|\s)r="([A-Z]+\d+)"/);
      if (!refMatch) continue;
      const ref = refMatch[1];
      const typeMatch = attrs.match(/(?:^|\s)t="([^"]+)"/);
      const type = typeMatch ? typeMatch[1] : '';
      const body = match[3] || '';
      const valueMatch = body.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/);
      const inlineMatch = body.match(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/);
      let value = valueMatch ? decodeXml(valueMatch[1]) : (inlineMatch ? decodeXml(inlineMatch[1]) : '');
      if (type === 's' && value !== '') value = shared[Number(value)] || '';
      cells.set(ref, value);
    }
    return cells;
  }

  function minor(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
    const parts = raw.split('.');
    const major = BigInt(parts[0]);
    const fraction = (parts[1] || '').padEnd(2, '0');
    const amount = major * 100n + BigInt(fraction || '0');
    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(amount);
  }

  function id(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function digits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function issue(code, row, field) {
    const out = { code, severity: 'blocking', source: 'caratula_xlsx_qa' };
    if (row) out.row = row;
    if (field) out.field = field;
    return out;
  }

  async function parse(input) {
    const bytes = asBytes(input);
    if (!bytes || bytes.byteLength < 22) {
      return { contractVersion: CONTRACT_VERSION, valid: false, people: [], issues: [issue(ISSUE.ZIP_INVALID)] };
    }
    try {
      const entries = await unzip(bytes);
      const target = sheetTarget(entries, SHEET_NAME);
      const sheet = xmlText(entries.get(target) || new Uint8Array());
      const shared = sharedStrings(entries.has('xl/sharedStrings.xml') ? xmlText(entries.get('xl/sharedStrings.xml')) : '');
      const cells = parseCells(sheet, shared);

      if (!String(cells.get('A1') || '').includes('SINTÉTICO QA') || cells.get('H6') !== 'NO CERTIFICADA') {
        return { contractVersion: CONTRACT_VERSION, valid: false, people: [], issues: [issue(ISSUE.CONTRACT_MISMATCH)] };
      }
      for (let index = 0; index < EXPECTED_HEADERS.length; index += 1) {
        const column = String.fromCharCode(65 + index);
        if (cells.get(column + '8') !== EXPECTED_HEADERS[index]) {
          return { contractVersion: CONTRACT_VERSION, valid: false, people: [], issues: [issue(ISSUE.CONTRACT_MISMATCH, 8, column)] };
        }
      }
      const recoveredMap = [['AD18','K18'],['AD11','K11'],['AD19','K19'],['AD14','K14'],['AD9','K9']];
      for (const pair of recoveredMap) {
        if (minor(cells.get(pair[0])) !== minor(cells.get(pair[1]))) {
          return { contractVersion: CONTRACT_VERSION, valid: false, people: [], issues: [issue(ISSUE.CONTRACT_MISMATCH, Number(pair[0].replace(/\D/g, '')), pair[0])] };
        }
      }

      const people = [];
      const issues = [];
      let netTotal = 0;
      let bankTotal = 0;
      let speiTotal = 0;
      let vouchersTotal = 0;
      for (let row = 9; row <= 20; row += 1) {
        const marker = String(cells.get('A' + row) || '').trim();
        if (!marker) continue;
        if (!/^QA-\d{3}$/.test(marker)) {
          issues.push(issue(ISSUE.ROW_INVALID, row, 'ID_QA'));
          continue;
        }
        const employeeName = String(cells.get('B' + row) || '').trim();
        const rfc = id(cells.get('C' + row));
        const curp = id(cells.get('D' + row));
        const nss = digits(cells.get('E' + row));
        const bankName = String(cells.get('F' + row) || '').trim();
        const account = digits(cells.get('G' + row));
        const clabe = digits(cells.get('H' + row));
        const net = minor(cells.get('I' + row));
        const bank = minor(cells.get('J' + row));
        const spei = minor(cells.get('K' + row));
        const vouchers = minor(cells.get('L' + row));
        if (!employeeName || (!rfc && !curp && !nss) || [net, bank, spei, vouchers].some(function (v) { return v === null; })) {
          issues.push(issue(ISSUE.ROW_INVALID, row));
          continue;
        }
        if (net <= 0 || bank < 0 || spei < 0 || vouchers < 0 || net !== bank + spei + vouchers) {
          issues.push(issue(ISSUE.TOTAL_MISMATCH, row));
          continue;
        }
        if (bank > 0 && (!account || spei > 0)) {
          issues.push(issue(ISSUE.ROW_INVALID, row, 'CUENTA'));
          continue;
        }
        if (spei > 0 && (!/^\d{18}$/.test(clabe) || bank > 0)) {
          issues.push(issue(ISSUE.ROW_INVALID, row, 'CLABE'));
          continue;
        }
        const cash = bank + spei;
        people.push({
          sourceRow: row,
          employeeName,
          normalizedName: employeeName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' '),
          rfc, curp, nss, bankName, account, clabe,
          netAmountMinor: net,
          coverCashAmountMinor: cash,
          coverVouchersAmountMinor: vouchers,
          bankAmountMinor: 0,
          speiAmountMinor: 0,
          vouchersAmountMinor: 0,
          qaChannelHints: { bankAmountMinor: bank, speiAmountMinor: spei, vouchersAmountMinor: vouchers }
        });
        netTotal += net;
        bankTotal += bank;
        speiTotal += spei;
        vouchersTotal += vouchers;
      }
      if (!people.length && !issues.length) issues.push(issue(ISSUE.CONTRACT_MISMATCH));
      if (![netTotal, bankTotal, speiTotal, vouchersTotal].every(Number.isSafeInteger)) {
        issues.push(issue(ISSUE.TOTAL_MISMATCH));
      }
      return {
        contractVersion: CONTRACT_VERSION,
        sheetName: SHEET_NAME,
        qaOnly: true,
        certifiedPhysicalSource: false,
        valid: issues.length === 0,
        people: issues.length === 0 ? people : [],
        totals: issues.length === 0 ? {
          netAmountMinor: netTotal,
          bankAmountMinor: bankTotal,
          speiAmountMinor: speiTotal,
          vouchersAmountMinor: vouchersTotal
        } : null,
        issues
      };
    } catch (error) {
      const code = error && /^PAYROLL_QA_COVER_[A-Z_]+$/.test(error.message) ? error.message : ISSUE.XML_INVALID;
      return { contractVersion: CONTRACT_VERSION, valid: false, people: [], issues: [issue(code)] };
    }
  }

  return Object.freeze({ CONTRACT_VERSION, FIXTURE_SHA256, SHEET_NAME, EXPECTED_HEADERS, RECOVERED_MAP: Object.freeze(['C6→AD18','C7→AD11','C8→AD19','C9→AD14','C10→AD9']), ISSUE, parse });
});
