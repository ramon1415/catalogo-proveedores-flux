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

test('report independently certifies SPEI and leaves three unproven adapters closed', () => {
  assert.match(report, /Payroll SPEI[\s\S]*CERTIFIED_FROM_MULTIPLE_CONVERGENT_SOURCES/i);
  assert.match(report, /Carátula XLSX[\s\S]*MISSING_PHYSICAL_SOURCE/i);
  assert.match(report, /BBVA same bank[\s\S]*PARTIAL_CONTRACT_ONLY/i);
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

test('report does not contain private paths or source byte examples', () => {
  assert.doesNotMatch(report, /C:\\Users|Downloads\\|OneDrive\\|file:\/\//i);
  assert.doesNotMatch(report, /\b[A-Z&Ñ]{3,}\s+[A-Z&Ñ]{3,}\s+[A-Z&Ñ]{3,}\b/);
  assert.doesNotMatch(report, /\b[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}\b/);
});
