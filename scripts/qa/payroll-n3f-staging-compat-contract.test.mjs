import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync('supabase/migrations/20260820004857_payroll_n3f_server_verification_staging.sql', 'utf8');
const n3f = fs.readFileSync('supabase/migrations/20260820002513_payroll_n3f_real_formats_toka_funding.sql', 'utf8');
const capture = fs.readFileSync('payroll_capture.js', 'utf8');
const edge = fs.readFileSync('supabase/functions/payroll-materialize/index.ts', 'utf8');

test('non-SPEI real physical files stage for server verification without browser parser authority', () => {
  assert.match(migration, /kind in \('caratula','layout_mismo_banco','layout_toka','cfdi_vales'\)/);
  assert.match(migration, /parsing_status='server_verification_pending'/);
  assert.match(migration, /validation_authority='server_only'/);
  assert.match(migration, /parser_version is null/);
  assert.match(migration, /parser_contract is null/);
  assert.match(migration, /record_count is null/);
  assert.match(migration, /total_amount_minor is null/);
  assert.match(migration, /payroll_capture_server_only_parser_metadata_forbidden/);
});

test('SPEI keeps the existing browser diagnostic contract while server remains final authority', () => {
  assert.match(migration, /kind='layout_spei'/);
  assert.match(migration, /client_parsed_unverified/);
  assert.match(migration, /browser_client_attested/);
  assert.match(migration, /payroll-normalized-v1/);
  assert.match(migration, /bbva-simulator-pagos-interbancarios-128-v1/);
  assert.match(edge, /authority:"server_verified"/);
  assert.match(edge, /browser_server_match:/);
});

test('existing capture UI remains compatible because only SPEI sends client parser metadata', () => {
  assert.match(capture, /p_parser_version: slot === 'layout_spei' \? summary\.parserVersion : null/);
  assert.match(capture, /p_parser_contract: slot === 'layout_spei' \? summary\.contractVersion : null/);
  assert.match(capture, /p_record_count: slot === 'layout_spei' \? summary\.recordCount : null/);
  assert.match(capture, /p_total_amount_minor: slot === 'layout_spei' \? summary\.totalAmountMinor : null/);
  assert.match(capture, /uploadable: true/);
  assert.match(capture, /status: 'blocked'/);
});

test('real TOKA still requires both funding and CFDI evidence at the server-side inventory boundary', () => {
  assert.match(n3f, /kind='layout_toka'/);
  assert.match(n3f, /kind='cfdi_vales'/);
  assert.match(n3f, /'vales'=any\(v_session\.expected_channels\)/);
  assert.match(edge, /expected\.has\("vales"\)\?\["layout_toka","cfdi_vales"\]/);
});

test('forward migration is zero-state, forward-only and contains no business-data backfill', () => {
  assert.match(migration, /payroll_n3f_staging_requires_zero_payroll_state/);
  assert.doesNotMatch(migration, /insert into public\.payment_requests/i);
  assert.doesNotMatch(migration, /insert into public\.payroll_channels/i);
  assert.doesNotMatch(migration, /delete from public\./i);
  assert.doesNotMatch(migration, /update public\.payroll_capture_(?:sessions|files)/i);
});
