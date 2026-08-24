#!/usr/bin/env bash
set -euo pipefail

EXPECTED_PROJECT_REF="scsirgbuqjcwoaxfacth"
EXPECTED_BRANCH="codex/flux-slice-03-contpaq-mapper-clean"
EXPECTED_SEED_COMMIT="4f56c254984e0e42bea37e1d41772d1a7c9ca50f"
COMPANY_ID="9680353c-9b86-4730-82e1-fce664f048a2"
SEED_DIR="supabase/seed/contpaq"
EVIDENCE_DIR="${OPS_EVIDENCE_DIR:-.ops-evidence/contpaq-dev-seed}"

: "${SUPABASE_DEV_DB_URL:?Missing SUPABASE_DEV_DB_URL}"
: "${SUPABASE_DEV_PROJECT_REF:?Missing SUPABASE_DEV_PROJECT_REF}"

if [[ "${SUPABASE_DEV_PROJECT_REF}" != "${EXPECTED_PROJECT_REF}" ]]; then
  echo "::error::Refusing to run outside approved DEV project ${EXPECTED_PROJECT_REF}."
  exit 1
fi

if [[ "${GITHUB_REF_NAME:-}" != "${EXPECTED_BRANCH}" ]]; then
  echo "::error::Refusing to run outside ${EXPECTED_BRANCH}."
  exit 1
fi

if ! git merge-base --is-ancestor "${EXPECTED_SEED_COMMIT}" HEAD; then
  echo "::error::The approved seed commit is not an ancestor of HEAD."
  exit 1
fi

mkdir -p "${EVIDENCE_DIR}"

cat > /tmp/contpaq-seed-sha256.txt <<'HASHES'
8a461f10752b4eed82df2d336934b21056de5684b22e573fee492654bf5707c6  supabase/seed/contpaq/catalogo_operadora.csv
3c68d1579e68b694975d460325d156226d93a46986036c35afbce1d7e77ba4a8  supabase/seed/contpaq/catalogo_operadora.sql
827ee2cab2e42f4f7c37fab715c2dc3750bbb621a176909fc79be9a72d63e55a  supabase/seed/contpaq/mapeos_operadora.csv
abb102d2c0469a5baafda3ab7f50201afad01889bfa7bdc394291eabc140bd23  supabase/seed/contpaq/mapeos_operadora.sql
HASHES
sha256sum -c /tmp/contpaq-seed-sha256.txt | tee "${EVIDENCE_DIR}/hash-check.txt"

catalog_rows=$(( $(wc -l < "${SEED_DIR}/catalogo_operadora.csv") - 1 ))
mapping_rows=$(( $(wc -l < "${SEED_DIR}/mapeos_operadora.csv") - 1 ))
placeholder_catalog=$(grep -o ':company_id' "${SEED_DIR}/catalogo_operadora.sql" | wc -l | tr -d ' ')
placeholder_mappings=$(grep -o ':company_id' "${SEED_DIR}/mapeos_operadora.sql" | wc -l | tr -d ' ')

[[ "${catalog_rows}" -eq 1646 ]] || { echo "::error::Expected 1646 catalog rows, got ${catalog_rows}."; exit 1; }
[[ "${mapping_rows}" -eq 87 ]] || { echo "::error::Expected 87 mapping rows, got ${mapping_rows}."; exit 1; }
[[ "${placeholder_catalog}" -eq 1646 ]] || { echo "::error::Expected 1646 catalog placeholders, got ${placeholder_catalog}."; exit 1; }
[[ "${placeholder_mappings}" -eq 87 ]] || { echo "::error::Expected 87 mapping placeholders, got ${placeholder_mappings}."; exit 1; }

python3 - <<'PY'
from pathlib import Path
source = Path("supabase/seed/contpaq/catalogo_operadora.sql").read_text(encoding="utf-8")
company_id = "9680353c-9b86-4730-82e1-fce664f048a2"
rendered = source.replace(":company_id", f"'{company_id}'::uuid")
if ":company_id" in rendered:
    raise SystemExit("Unresolved :company_id placeholder")
Path("/tmp/catalogo_operadora_dev.sql").write_text(rendered, encoding="utf-8")
PY

absolute_mapping_csv="$(pwd)/${SEED_DIR}/mapeos_operadora.csv"

cat > /tmp/load_contpaq_operadora_dev.sql <<SQL
\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '10min';
SET LOCAL lock_timeout = '15s';
SET LOCAL client_encoding = 'UTF8';

DO \$\$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.companies
    WHERE id = '${COMPANY_ID}'::uuid
      AND active
      AND lower(name) = lower('Operadora Tlacatecpan')
  ) THEN
    RAISE EXCEPTION 'approved_dev_company_not_found';
  END IF;
  IF to_regclass('public.contpaq_accounts') IS NULL
     OR to_regclass('public.budget_account_mappings') IS NULL THEN
    RAISE EXCEPTION 'contpaq_mapper_schema_missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'budget_account_mappings'
      AND column_name = 'mapping_evidence'
  ) THEN
    RAISE EXCEPTION 'mapping_evidence_contract_missing';
  END IF;
END
\$\$;

\\i /tmp/catalogo_operadora_dev.sql

CREATE TEMP TABLE contpaq_seed_mapeos (
  partida_code text NOT NULL,
  partida text NOT NULL,
  grupo text NOT NULL,
  cuenta text NOT NULL,
  cuenta_nombre text NOT NULL,
  metodo text NOT NULL,
  evidencia text NOT NULL,
  needs_review boolean NOT NULL
) ON COMMIT DROP;

\\copy contpaq_seed_mapeos(partida_code,partida,grupo,cuenta,cuenta_nombre,metodo,evidencia,needs_review) FROM '${absolute_mapping_csv}' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')

DO \$\$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM contpaq_seed_mapeos;
  IF v_count <> 87 THEN RAISE EXCEPTION 'mapping_seed_count_mismatch:%', v_count; END IF;

  SELECT count(*) INTO v_count
  FROM (
    SELECT partida_code
    FROM contpaq_seed_mapeos
    GROUP BY partida_code
    HAVING count(*) <> 1
  ) duplicate_codes;
  IF v_count <> 0 THEN RAISE EXCEPTION 'mapping_seed_duplicate_partida_codes:%', v_count; END IF;

  SELECT count(*) INTO v_count
  FROM contpaq_seed_mapeos
  WHERE metodo NOT IN ('nombre_exacto', 'criterio');
  IF v_count <> 0 THEN RAISE EXCEPTION 'mapping_seed_unknown_methods:%', v_count; END IF;

  SELECT count(*) INTO v_count
  FROM (
    SELECT s.partida_code
    FROM contpaq_seed_mapeos s
    LEFT JOIN public.budget_categories b ON b.code = s.partida_code
    GROUP BY s.partida_code
    HAVING count(b.id) <> 1
  ) unresolved;
  IF v_count <> 0 THEN RAISE EXCEPTION 'mapping_seed_budget_category_resolution_failed:%', v_count; END IF;

  SELECT count(*) INTO v_count
  FROM (
    SELECT DISTINCT s.cuenta
    FROM contpaq_seed_mapeos s
    LEFT JOIN public.contpaq_account_mapper_candidates a
      ON a.company_id = '${COMPANY_ID}'::uuid
     AND a.code = s.cuenta
    WHERE a.code IS NULL OR NOT a.elegible_mapper
  ) invalid_accounts;
  IF v_count <> 0 THEN RAISE EXCEPTION 'mapping_seed_ineligible_accounts:%', v_count; END IF;
END
\$\$;

INSERT INTO public.budget_account_mappings (
  company_id,
  budget_category_id,
  contpaq_account_code,
  needs_review,
  mapping_method,
  mapping_reason,
  mapping_evidence
)
SELECT
  '${COMPANY_ID}'::uuid,
  b.id,
  s.cuenta,
  s.needs_review,
  CASE s.metodo
    WHEN 'nombre_exacto' THEN 'exact_name'
    WHEN 'criterio' THEN 'judgment'
  END,
  NULL,
  s.evidencia
FROM contpaq_seed_mapeos s
JOIN public.budget_categories b ON b.code = s.partida_code
ON CONFLICT (company_id, budget_category_id) DO UPDATE SET
  contpaq_account_code = EXCLUDED.contpaq_account_code,
  needs_review = EXCLUDED.needs_review,
  mapping_method = EXCLUDED.mapping_method,
  mapping_evidence = EXCLUDED.mapping_evidence;

ALTER TABLE public.budget_account_mappings
  VALIDATE CONSTRAINT budget_account_mappings_evidence_length_check;
ALTER TABLE public.budget_account_mappings
  VALIDATE CONSTRAINT budget_account_mappings_evidence_required_check;

DO \$\$
DECLARE
  v_accounts integer;
  v_detail integer;
  v_tree integer;
  v_type integer;
  v_nif integer;
  v_synced integer;
  v_mappings integer;
  v_distinct integer;
  v_exact integer;
  v_judgment integer;
  v_review integer;
  v_evidence integer;
  v_invalid integer;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (WHERE is_detail),
    count(*) FILTER (WHERE cta_sup IS NOT NULL),
    count(*) FILTER (WHERE tipo IS NOT NULL),
    count(*) FILTER (WHERE rubro_nif IS NOT NULL),
    count(*) FILTER (WHERE sincronizado_el IS NOT NULL)
  INTO v_accounts, v_detail, v_tree, v_type, v_nif, v_synced
  FROM public.contpaq_accounts
  WHERE company_id = '${COMPANY_ID}'::uuid;

  SELECT
    count(*),
    count(DISTINCT contpaq_account_code),
    count(*) FILTER (WHERE mapping_method = 'exact_name'),
    count(*) FILTER (WHERE mapping_method = 'judgment'),
    count(*) FILTER (WHERE needs_review),
    count(*) FILTER (WHERE coalesce(char_length(btrim(mapping_evidence)), 0) >= 8)
  INTO v_mappings, v_distinct, v_exact, v_judgment, v_review, v_evidence
  FROM public.budget_account_mappings
  WHERE company_id = '${COMPANY_ID}'::uuid;

  SELECT count(*) INTO v_invalid
  FROM public.budget_account_mappings m
  LEFT JOIN public.contpaq_account_mapper_candidates a
    ON a.company_id = m.company_id
   AND a.code = m.contpaq_account_code
  WHERE m.company_id = '${COMPANY_ID}'::uuid
    AND (a.code IS NULL OR NOT a.elegible_mapper);

  IF v_accounts <> 1646 OR v_detail <> 1402 OR v_tree <> 1646 OR v_type <> 1646
     OR v_nif <> 1440 OR v_synced <> 1646 THEN
    RAISE EXCEPTION 'catalog_postcheck_failed accounts:% detail:% tree:% type:% nif:% synced:%',
      v_accounts, v_detail, v_tree, v_type, v_nif, v_synced;
  END IF;

  IF v_mappings <> 87 OR v_distinct <> 63 OR v_exact <> 22 OR v_judgment <> 65
     OR v_review <> 6 OR v_evidence <> 87 OR v_invalid <> 0 THEN
    RAISE EXCEPTION 'mapping_postcheck_failed mappings:% distinct:% exact:% judgment:% review:% evidence:% invalid:%',
      v_mappings, v_distinct, v_exact, v_judgment, v_review, v_evidence, v_invalid;
  END IF;
END
\$\$;

COMMIT;
SQL

postcheck_query="
SELECT json_build_object(
  'company_id', '${COMPANY_ID}',
  'account_rows', (SELECT count(*) FROM public.contpaq_accounts WHERE company_id='${COMPANY_ID}'::uuid),
  'detail_rows', (SELECT count(*) FROM public.contpaq_accounts WHERE company_id='${COMPANY_ID}'::uuid AND is_detail),
  'tree_rows', (SELECT count(*) FROM public.contpaq_accounts WHERE company_id='${COMPANY_ID}'::uuid AND cta_sup IS NOT NULL),
  'typed_rows', (SELECT count(*) FROM public.contpaq_accounts WHERE company_id='${COMPANY_ID}'::uuid AND tipo IS NOT NULL),
  'nif_rows', (SELECT count(*) FROM public.contpaq_accounts WHERE company_id='${COMPANY_ID}'::uuid AND rubro_nif IS NOT NULL),
  'synced_rows', (SELECT count(*) FROM public.contpaq_accounts WHERE company_id='${COMPANY_ID}'::uuid AND sincronizado_el IS NOT NULL),
  'mapping_rows', (SELECT count(*) FROM public.budget_account_mappings WHERE company_id='${COMPANY_ID}'::uuid),
  'distinct_accounts', (SELECT count(DISTINCT contpaq_account_code) FROM public.budget_account_mappings WHERE company_id='${COMPANY_ID}'::uuid),
  'exact_name_rows', (SELECT count(*) FROM public.budget_account_mappings WHERE company_id='${COMPANY_ID}'::uuid AND mapping_method='exact_name'),
  'judgment_rows', (SELECT count(*) FROM public.budget_account_mappings WHERE company_id='${COMPANY_ID}'::uuid AND mapping_method='judgment'),
  'needs_review_rows', (SELECT count(*) FROM public.budget_account_mappings WHERE company_id='${COMPANY_ID}'::uuid AND needs_review),
  'evidence_rows', (SELECT count(*) FROM public.budget_account_mappings WHERE company_id='${COMPANY_ID}'::uuid AND coalesce(char_length(btrim(mapping_evidence)),0)>=8),
  'formal_reason_rows', (SELECT count(*) FROM public.budget_account_mappings WHERE company_id='${COMPANY_ID}'::uuid AND coalesce(char_length(btrim(mapping_reason)),0)>=8)
)::text;
"

psql "${SUPABASE_DEV_DB_URL}" -X -v ON_ERROR_STOP=1 -Atc "
SELECT json_build_object(
  'phase','precheck',
  'company_name',(SELECT name FROM public.companies WHERE id='${COMPANY_ID}'::uuid),
  'account_rows',(SELECT count(*) FROM public.contpaq_accounts WHERE company_id='${COMPANY_ID}'::uuid),
  'mapping_rows',(SELECT count(*) FROM public.budget_account_mappings WHERE company_id='${COMPANY_ID}'::uuid)
)::text;
" | tee "${EVIDENCE_DIR}/precheck.json"

psql "${SUPABASE_DEV_DB_URL}" -X -v ON_ERROR_STOP=1 -f /tmp/load_contpaq_operadora_dev.sql
psql "${SUPABASE_DEV_DB_URL}" -X -v ON_ERROR_STOP=1 -Atc "${postcheck_query}" | tee "${EVIDENCE_DIR}/postcheck-pass-1.json"

# Segunda ejecución: demuestra idempotencia funcional (mismos conteos y clasificación).
psql "${SUPABASE_DEV_DB_URL}" -X -v ON_ERROR_STOP=1 -f /tmp/load_contpaq_operadora_dev.sql
psql "${SUPABASE_DEV_DB_URL}" -X -v ON_ERROR_STOP=1 -Atc "${postcheck_query}" | tee "${EVIDENCE_DIR}/postcheck-pass-2.json"

python3 - <<'PY'
import json
from pathlib import Path
p1 = json.loads(Path('.ops-evidence/contpaq-dev-seed/postcheck-pass-1.json').read_text())
p2 = json.loads(Path('.ops-evidence/contpaq-dev-seed/postcheck-pass-2.json').read_text())
if p1 != p2:
    raise SystemExit(f"Idempotence postchecks differ: {p1!r} != {p2!r}")
Path('.ops-evidence/contpaq-dev-seed/idempotence.txt').write_text('PASS: postcheck pass 1 == pass 2\n')
PY

echo "PASS / CONTPAQ_DEV_SEED_LOADED_AND_REPLAYED"
