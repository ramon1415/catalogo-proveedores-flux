# Flux — Plataforma React (v2)

SPA que reemplaza gradualmente el frontend HTML vanilla (estrategia strangler).
Vive en `/app` del repo vanilla para **compartir origen y sesión de Supabase**.

## Stack
Vite + React + TypeScript + Supabase. Sin Next (app interna, sin SSR). CSS Modules (scope).

## Correr en local
```bash
cd app
cp .env.example .env      # VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY reales
npm install
npm run dev               # sirve en /app/  (base configurada)
npm run build             # typecheck + build a dist/
```

## La frontera con lo vanilla (deploy — pendiente de Ramón)
- `flux.quantta.mx/*`  → vanilla (deploy actual, sin cambios).
- `flux.quantta.mx/app/*` → esta SPA, con **fallback SPA** (`/app/*` → `/app/index.html`).
- Mismo origen ⇒ la sesión de Supabase (`sb-<ref>-auth-token` en localStorage) se comparte ⇒ **cero re-login** al cruzar. Ese es el gate de F1.

**Config a decidir (no incluida para no romper el deploy static actual):**
`vite base` ya está en `/app/`. Falta el `vercel.json` en la raíz del repo que:
1. buildee la SPA (`cd app && npm ci && npm run build`) y publique `app/dist` bajo `/app/`,
2. mantenga el vanilla estático en `/`,
3. agregue rewrite de fallback: `/app/(.*)` → `/app/index.html`.

Ramón valida/define esto antes de que toque prod (puede romper el deploy static si se hace mal).

## Estructura
```
src/
  lib/       supabase · auth · company          (kernel F1)
  theme/     tokens.css                          (portado de ux2_shared.css)
  components/ui/  icons · Nav (rail hover) · AppShell   (design system F2)
  pages/     Login · Home
```

## Estado
- F1 (kernel + auth + /app): construido, compila, corre. Falta gate de sesión compartida con creds reales.
- F2 (design system + menú): construido, verificado (colapsado + hover-expand).
- Siguiente: F3 (migrar `proveedores` end-to-end → medir).
