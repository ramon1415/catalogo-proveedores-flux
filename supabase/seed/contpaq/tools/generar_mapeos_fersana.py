#!/usr/bin/env python3
"""Genera 40_mapeos_soporte_fersana.sql desde data/mapeos_soporte_fersana.json.
Determinista: mismo JSON ⇒ mismo archivo (sha256 en MANIFEST.txt)."""
import hashlib, json, pathlib

base = pathlib.Path(__file__).resolve().parent.parent
src = base / 'data' / 'mapeos_soporte_fersana.json'
dst = base / '40_mapeos_soporte_fersana.sql'
d = json.loads(src.read_text(encoding='utf-8'))
m = d['mapeos']
sha = hashlib.sha256(src.read_bytes()).hexdigest()
assert len(m) == 60 and len({x[0] for x in m}) == 60, 'se esperan 60 partidas distintas'
nr = sum(1 for x in m if x[2])
ex = sum(1 for x in m if x[3] == 'exact_name')
out = [
    "-- Mapeo partida→cuenta · Soporte Fersana (60 partidas SF-2026)",
    "-- Generado por supabase/seed/contpaq/tools/generar_mapeos_fersana.py — NO editar a mano.",
    f"-- Fuente: supabase/seed/contpaq/data/mapeos_soporte_fersana.json (sha256 {sha})",
    f"-- {len(m)} mapeos · {ex} exact_name · {len(m) - ex} judgment · {nr} needs_review (quedan pendientes; la carga NO los aprueba)",
    "-- La partida se resuelve por su código (budget_categories.code); si el código no existe la fila se omite",
    "-- y el postcheck lo reporta. Idempotente: on conflict do nothing conserva lo que Finanzas ya haya decidido.",
    "-- Reemplazar :company_id antes de ejecutar.",
    "",
    "insert into budget_account_mappings (company_id, budget_category_id, contpaq_account_code, needs_review, mapping_method)",
    "select :company_id, bc.id, v.cuenta, v.needs_review, v.method",
    "from (values",
    ",\n".join(f"  ('{c}', '{a}', {'true' if n else 'false'}, '{me}')" for c, a, n, me in m),
    ") as v(code, cuenta, needs_review, method)",
    "join budget_categories bc on bc.code = v.code",
    "on conflict (company_id, budget_category_id, contpaq_account_code) do nothing;",
]
dst.write_text("\n".join(out) + "\n", encoding='utf-8')
print(f'{dst.name}: {len(m)} mapeos, {nr} needs_review')
