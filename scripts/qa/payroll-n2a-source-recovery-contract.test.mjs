import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(readFileSync(
  new URL('./fixtures/payroll/source-manifest.json', import.meta.url),
  'utf8'
));
const report = readFileSync(
  new URL('../../docs/ops/payroll-source-recovery-report.md', import.meta.url),
  'utf8'
);
const sourcesByEvidenceId = Object.fromEntries(
  manifest.sources
    .filter((source) => source.evidence_id)
    .map((source) => [source.evidence_id, source])
);

test('source manifest is metadata-only and forbids real source fixtures', () => {
  assert.match(manifest.notice, /METADATA_ONLY.*NO_REAL_VALUES/i);
  assert.ok(manifest.sources.length >= 6);
  for (const source of manifest.sources) {
    assert.match(source.logical_name, /^[a-z0-9_]+$/);
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isInteger(source.size_bytes) && source.size_bytes > 0);
    assert.equal(typeof source.pii_present, 'boolean');
    assert.equal(source.repo_fixture_allowed, false);
    assert.equal('path' in source, false);
    assert.equal('source_path' in source, false);
  }
  assert.doesNotMatch(JSON.stringify(manifest), /Users|Downloads|OneDrive|Ram[oó]n Guillermo/i);
});

test('R2 manifest certifies both physical XLSM inputs without promoting output formats', () => {
  const interbank = sourcesByEvidenceId.INTERBANK_PAYROLL_XLSM_INPUT;
  const toka = sourcesByEvidenceId.TOKA_XLSM_INPUT;

  assert.ok(interbank);
  assert.equal(interbank.classification, 'SOURCE_PHYSICAL_SUPPORTING');
  assert.equal(interbank.evidence_kind, 'INPUT_PHYSICAL');
  assert.equal(interbank.sha256, 'cc5b4376a2bd7c9b8e1de02b29cafbf186e03d371bc0b9ce7364bc4da26df556');
  assert.deepEqual(interbank.facts, {
    record_count: 5,
    external_cover_sheet_reference: true,
    same_bank_record_count: 0,
    sheet_count: 53,
    vba_present: true
  });
  assert.match(interbank.format_contract_status, /PAYROLL_SPEI_INPUT:CERTIFIED/);
  assert.match(interbank.format_contract_status, /BBVA_SAME_BANK_GENERATOR:GENERATOR_CONTRACT_CERTIFIED/);
  assert.match(interbank.format_contract_status, /BBVA_SAME_BANK_TXT:PARTIAL_CONTRACT_ONLY/);

  assert.ok(toka);
  assert.equal(toka.classification, 'SOURCE_PHYSICAL_SUPPORTING');
  assert.equal(toka.evidence_kind, 'INPUT_PHYSICAL');
  assert.equal(toka.sha256, '66f20373ceea98aec461ff91526a182c2155bc1435e807fc0f88fc1ff042450d');
  assert.deepEqual(toka.facts, {
    aggregate_transfer_count: 1,
    same_bank_record_count: 0,
    sheet_count: 53,
    vba_present: true
  });
  assert.match(toka.format_contract_status, /TOKA_AGGREGATE_TRANSFER:CERTIFIED_FROM_PHYSICAL_INPUT/);
  assert.match(toka.format_contract_status, /TOKA_XML:MISSING_PHYSICAL_SOURCE/);
});

test('report separates physical inputs, generator source, and physical outputs', () => {
  assert.match(report, /INPUT_PHYSICAL/);
  assert.match(report, /GENERATOR_SOURCE/);
  assert.match(report, /OUTPUT_PHYSICAL/);
  assert.match(report, /PAYROLL_SPEI_INPUT[\s\S]*CERTIFIED/i);
  assert.match(report, /Payroll SPEI[\s\S]*CERTIFIED_FROM_MULTIPLE_CONVERGENT_SOURCES/i);
  assert.match(report, /Carátula XLSX[\s\S]*MISSING_PHYSICAL_SOURCE/i);
  assert.match(report, /BBVA same bank[\s\S]*GENERATOR_CONTRACT_CERTIFIED[\s\S]*PARTIAL_CONTRACT_ONLY/i);
  assert.match(report, /TOKA_AGGREGATE_TRANSFER[\s\S]*CERTIFIED_FROM_PHYSICAL_INPUT/i);
  assert.match(report, /TOKA XML found:\s*\*\*NO\*\*/i);
  assert.match(report, /parsePayrollCoverSheet[\s\S]*fail-closed/i);
  assert.match(report, /parsePayrollBbvaSameBank[\s\S]*fail-closed/i);
  assert.match(report, /parsePayrollTokaXml[\s\S]*fail-closed/i);
});

test('report records exhaustive search, zero mutations, and exact remaining artifacts', () => {
  assert.match(report, /258 refs remotos/i);
  assert.match(report, /361 refs de heads de PR/i);
  assert.match(report, /258 artifacts de GitHub Actions/i);
  assert.match(report, /DB writes:\s*0/i);
  assert.match(report, /All mutations:\s*0/i);
  assert.match(report, /Reporte de nómina periodo 15\.xlsx/i);
  assert.match(report, /TXT físico de Nómina BBVA mismo banco/i);
  assert.match(report, /XML TOKA\/CFDI/i);
});

test('report records provenance, TOKA decision, and a gated N2B start', () => {
  assert.match(report, /C6.*AD18[\s\S]*C10.*AD9/i);
  assert.match(report, /001001[\s\S]*0 ocurrencias/i);
  assert.match(report, /Opción A[\s\S]*Opción B/i);
  assert.match(report, /CAN_N2B_CAPTURE_UI_START\s*=\s*YES/i);
  assert.match(report, /Enviar a aprobación[\s\S]*bloquead/i);
});

test('report does not contain private paths or source byte examples', () => {
  assert.doesNotMatch(report, /C:\\Users|Downloads\\|OneDrive\\|file:\/\//i);
  assert.doesNotMatch(report, /\b[A-Z&Ñ]{3,}\s+[A-Z&Ñ]{3,}\s+[A-Z&Ñ]{3,}\b/);
  assert.doesNotMatch(report, /\b[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}\b/);
});
