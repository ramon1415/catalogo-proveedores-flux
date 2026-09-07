#!/usr/bin/env python3
"""Verifica que cada archivo de la semilla tenga el sha256 del MANIFEST.
Sale con código 1 si algo cambió: la semilla NO se aplica con fuentes alteradas."""
import hashlib, pathlib, re, sys
base = pathlib.Path(__file__).resolve().parent.parent
manifest = (base / 'MANIFEST.txt').read_text(encoding='utf-8')
ok = True
for m in re.finditer(r'^([0-9a-f]{64})\s{2}(\S+)$', manifest, re.M):
    sha, rel = m.group(1), m.group(2)
    p = base / rel
    real = hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
    estado = 'ok' if real == sha else 'CAMBIÓ' if real else 'FALTA'
    ok &= estado == 'ok'
    print(f'{estado:7} {rel}')
sys.exit(0 if ok else 1)
