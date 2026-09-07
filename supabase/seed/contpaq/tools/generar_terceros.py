#!/usr/bin/env python3
"""Genera 30_terceros_operadora.sql desde el padrón CSV del módulo.

Uso: python3 tools/generar_terceros.py <ruta a opt_padron_terceros.csv>
Determinista: misma fuente ⇒ mismo archivo (sha256 en MANIFEST.txt).
"""
import collections, csv, hashlib, pathlib, sys

src = pathlib.Path(sys.argv[1])
dst = pathlib.Path(__file__).resolve().parent.parent / '30_terceros_operadora.sql'
sha = hashlib.sha256(src.read_bytes()).hexdigest()
rows = list(csv.DictReader(src.open(encoding='utf-8')))

# Un mismo id_contpaq puede aparecer en el padrón de proveedores Y en el de
# clientes (misma razón social y RFC). La PK (company_id, id_contpaq) es la
# de CONTPAQ: una fila por id, y se conserva la de proveedor (DIOT/V).
byid = {}
for r in rows:
    k = r['id_contpaq']
    if k not in byid or (byid[k]['tipo'] != 'proveedor' and r['tipo'] == 'proveedor'):
        byid[k] = r
dups = sorted((k for k, c in collections.Counter(r['id_contpaq'] for r in rows).items() if c > 1), key=int)
q = lambda s: "'" + s.replace("'", "''") + "'"
n_prov = sum(1 for r in rows if r['tipo'] == 'proveedor')
n_cli = sum(1 for r in rows if r['tipo'] == 'cliente')

out = [
    "-- Padrón de terceros de CONTPAQ · Operadora Tlacatecpan",
    "-- Generado por supabase/seed/contpaq/tools/generar_terceros.py — NO editar a mano.",
    "-- Fuente: data/contpaq/opt_padron_terceros.csv (módulo flux-contpaq-export; Control de IVA → Bajar)",
    f"-- sha256 fuente: {sha}",
    f"-- {len(rows)} filas en la fuente ({n_prov} proveedores + {n_cli} clientes)",
    f"-- {len(byid)} terceros distintos: los ids {', '.join(dups)} aparecen en ambos padrones (misma razón social y RFC) y se conservan como proveedor.",
    "-- Idempotente: on conflict actualiza nombre/rfc/tipo; una segunda corrida no duplica.",
    "-- Reemplazar :company_id antes de ejecutar.",
    "",
    "insert into contpaq_terceros (company_id, id_contpaq, nombre, rfc, tipo_tercero, sincronizado_el)",
    "values",
    ",\n".join(
        f"  (:company_id, {q(r['id_contpaq'])}, {q(r['nombre'])}, {q(r['rfc']) if r['rfc'] else 'null'}, {q(r['tipo'])}, now())"
        for r in sorted(byid.values(), key=lambda r: int(r['id_contpaq']))
    ),
    "on conflict (company_id, id_contpaq) do update set",
    "  nombre = excluded.nombre, rfc = excluded.rfc, tipo_tercero = excluded.tipo_tercero, sincronizado_el = excluded.sincronizado_el;",
]
dst.write_text("\n".join(out) + "\n", encoding='utf-8')
print(f'{dst.name}: {len(byid)} terceros (fuente {len(rows)}, duplicados {dups})')
