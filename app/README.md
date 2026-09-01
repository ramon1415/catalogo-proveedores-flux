# Flux — Plataforma React (v2)

SPA principal que reemplaza gradualmente el frontend HTML vanilla (estrategia strangler).
Vive en la raíz del mismo origen para compartir sesión de Supabase; el vanilla
interno permanece disponible bajo `/legacy` como rollback.

## Stack
Vite + React + TypeScript + Supabase. Sin Next (app interna, sin SSR). CSS Modules (scope).

## Correr en local
```bash
cd app
cp .env.example .env      # VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY reales
npm install
npm run dev               # sirve la SPA desde /
npm run build             # typecheck + build a dist/
```

## La frontera con lo vanilla
- `flux.quantta.mx/*` → React en las rutas internas registradas.
- `flux.quantta.mx/app/*` → redirección temporal a la ruta equivalente sin `/app`.
- `flux.quantta.mx/legacy/*` → vanilla interno completo como rollback.
- `/solicitar.html` y `/approval_batch_quick_approve.html` conservan su URL pública.
- Mismo origen ⇒ la sesión de Supabase (`sb-<ref>-auth-token` en localStorage) se comparte ⇒ **cero re-login** al cruzar. Ese es el gate de F1.

`vite base` está en `/`. El build y `vercel.json`:
1. publican `app/dist` en la raíz,
2. preservan el vanilla completo en `/legacy`,
3. mantienen las superficies públicas canónicas,
4. redirigen `/app/*` y los HTML internos antiguos a React,
5. declaran los fallbacks SPA ruta por ruta para no interceptar APIs ni archivos públicos.

## Estructura
```
src/
  lib/       supabase · auth · company          (kernel F1)
  theme/     tokens.css                          (portado de ux2_shared.css)
  components/ui/  icons · Nav (rail hover) · AppShell   (design system F2)
  pages/     Login · Home
```

## Estado
- F1 (kernel + auth): construido, compila y corre en la raíz.
- F2 (design system + menú): construido, verificado (colapsado + hover-expand).
- Siguiente: F3 (migrar `proveedores` end-to-end → medir).
