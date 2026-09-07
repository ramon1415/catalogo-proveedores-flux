#!/usr/bin/env bash
# Carga idempotente de la semilla FB-Integración (catálogos, renglones,
# terceros, mapeos SF). Requiere psql y DATABASE_URL (rol postgres/service).
#
#   DATABASE_URL=postgres://... supabase/seed/contpaq/apply.sh
#
# Orden y empresa de cada archivo son fijos; todo corre en UNA transacción:
# si algo falla no queda nada a medias. Segunda corrida = mismos conteos.
set -euo pipefail
cd "$(dirname "$0")"
: "${DATABASE_URL:?DATABASE_URL requerido}"

OPT=9680353c-9b86-4730-82e1-fce664f048a2   # Operadora Tlacatecpan
SF=68b61801-74c0-44ea-a33b-f20e4bf53aa7    # Soporte Fersana

# Verifica integridad de las fuentes antes de tocar la base.
python3 tools/verificar_manifest.py

{
  echo 'begin;'
  sed "s/:company_id/'$OPT'/g" 10_catalogo_operadora.sql
  sed "s/:company_id/'$SF'/g"  11_catalogo_soporte_fersana.sql
  sed "s/:company_id/'$OPT'/g" 20_renglones_operadora.sql
  sed "s/:company_id/'$SF'/g"  21_renglones_soporte_fersana.sql
  sed "s/:company_id/'$OPT'/g" 30_terceros_operadora.sql
  sed "s/:company_id/'$SF'/g"  40_mapeos_soporte_fersana.sql
  echo 'commit;'
} | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q

echo '--- postcheck'
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f postcheck.sql
