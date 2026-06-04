# Flux Operadora — Instrucciones para el agente

## Proyecto
Sistema financiero interno para Flux Operadora. Gestiona solicitudes de pago, layouts, efectivo, ingresos, presupuesto, proveedores y aprobaciones.

- **Repo:** https://github.com/ramon1415/catalogo-proveedores-flux
- **Vercel prod:** https://catalogo-proveedores-flux.vercel.app (rama `main`)
- **Vercel staging/dev:** URL generada automáticamente por Vercel al hacer merge a `dev`
- **Vercel preview por rama:** URL única por cada branch/PR — ej. `catalogo-proveedores-flux-git-fix-ramon-*-quantta-team.vercel.app`
- **Supabase:** https://scsirgbuqjcwoaxfacth.supabase.co (instancia única para dev y prod)

## Stack
HTML estático + JS vanilla por módulo. Sin framework de build ni bundler. No hay `package.json`. Los archivos se editan directamente y un push despliega en Vercel.

## Reglas de branching — OBLIGATORIAS

```
main        ← producción, solo recibe PRs desde dev
└── dev     ← staging, base de todo el trabajo
    ├── feature/carlos-*   ← rama de Carlos
    └── feature/ramon-*    ← rama de Ramon
```

1. **Nunca hagas commits directamente en `main` ni en `dev`.**
2. Crea siempre tu branch desde `dev`:
   ```bash
   git checkout dev && git pull origin dev
   git checkout -b feature/tu-nombre-descripcion
   ```
3. Al terminar, abre PR hacia `dev` (no hacia `main`).
4. Cuando `dev` esté validado en staging, se abre PR de `dev` → `main`.

## Convención de nombres de branch
- `feature/carlos-solicitudes-filtros`
- `feature/ramon-proveedores-modal`
- `fix/carlos-ingresos-nav`
- `fix/ramon-layouts-export`

## Estructura de archivos
Cada módulo tiene su par `nombre.html` + `nombre.js`. Las extensiones UX son archivos `*_extension.js` o `*_patch.js` que se cargan dinámicamente desde `auth.js`.

| Archivo | Módulo |
|---|---|
| `index.html` | Login (Google OAuth) |
| `solicitudes.html/js` | Solicitudes de pago |
| `layouts.html/js` | Layouts de pago |
| `efectivo.html/js` | Efectivo y comprobaciones |
| `ingresos.html/js` | Ingresos e incidencias |
| `proveedores.html/js` | Proveedores |
| `dashboard.html/js` | Dashboard operativo |
| `aprobaciones.html/js` | Cola de aprobación |
| `configuracion.html/js` | Configuración |
| `socios.html/js` | Miembros (sub-tab de config) |
| `presupuesto.html/js` | Presupuesto |

## Supabase
- Config en `config.js` — `SUPABASE_URL` y `SUPABASE_ANON_KEY`
- **Nunca uses la service key en frontend.**
- Auth via `auth.js` → `FluxAuth.ready()` resuelve roles antes de renderizar.
- Tablas principales: `profiles`, `user_roles`, `roles`, `cost_centers`

## Roles y acceso
| Grupo | Roles en DB | Acceso |
|---|---|---|
| `sysadmin` | sysadmin, system_admin, admin | Total |
| `admin_finance` | finance, finanzas, treasury, tesoreria | Casi todo |
| `direction` | approver_2, aprobador_2, direccion, director | Aprobaciones |
| `operation` | solicitante, operator, default | Solo solicitudes |

## Deploy
Push a `main` → Vercel despliega automáticamente a prod. Cualquier otro branch → Vercel genera URL de preview única.

## Criterio de UI — cómo nos gusta el diseño

### Filosofía general
- **Información de referencia vs. información de acción.** Los datos de contexto (proveedor, empresa, partida, mes) van compactos en un `ref-grid` de 2 columnas. Los datos de la solicitud en sí (monto, fecha, estatus) van destacados con jerarquía visual clara.
- **Sin ruido.** No hay bordes entre cada campo de un formulario — solo bajo el título de sección. Las líneas separadoras se usan solo donde hay un salto semántico real.
- **Densidad controlada.** Preferimos compacto pero respirable. Padding generoso antes de un salto de línea. Nunca sacrificar legibilidad por ahorrar espacio vertical.
- **Jerarquía por color y peso, no por tamaño.** El monto destacado usa `accent-text` + tamaño grande. Los labels usan `text-3` uppercase 10px. El texto principal usa `text-1` 600.

### Tokens y sistema de colores
Todos los colores vienen de variables CSS en `ux2_shared.css`. **Nunca uses hex directamente en componentes.** El sistema soporta dark (default) y light (`[data-theme=light]`) automáticamente.

| Semántica | Variable | Uso |
|---|---|---|
| Primario | `--accent` / `--accent-text` | Acciones principales, tab activo, links |
| Éxito | `--emerald` / `--emerald-dim` | Aprobado, pagado, completo |
| Error | `--ruby` / `--ruby-dim` | Rechazado, faltante, error |
| Advertencia | `--amber` / `--amber-dim` | Pendiente, cancelado, acción irreversible |
| Información | `--sky` / `--sky-dim` | Enviado, programado, en revisión |
| Especial | `--violet` / `--violet-dim` | Excepción, extraordinario |
| Neutro | `--text-2/3`, `--border` | Borrador, sin validar |

### Badges — clase `.b`
Siempre usar `.b` + variante semántica. Texto corto en español. Sin iconos ni punto decorativo.
```html
<span class="b b-success">Aprobada</span>
<span class="b b-warning">Pendiente</span>
<span class="b b-violet">Excepción</span>
```
Variantes: `b-success`, `b-danger`, `b-warning`, `b-info`, `b-neutral`, `b-accent`, `b-violet`.

### Notices — clase `.notice-v2`
Siempre en una sola línea: título en negrita + `—` + descripción. Sin `<br>`. Si el texto es largo, wrappea naturalmente.
```html
<div class="notice-v2 info">
  <span class="notice-icon">✓</span>
  <span class="notice-text">
    <span class="notice-title">Título</span>
    <span class="notice-sep">—</span>
    <span class="notice-desc">Descripción en la misma línea.</span>
  </span>
</div>
```

### Tablas
6 columnas máximo. Cada celda tiene `.cell-main` (blanco, 12.5px, 600) y `.cell-sub` (gris, 10.5px). Las acciones de fila se ocultan con `opacity:0` y aparecen en hover. Toolbar: búsqueda + 2 filtros máximo + separador + acciones globales.

### Modales
- **Consulta:** header solo con folio, monto destacado en accent-text 24px, ref-grid compacto, secciones de datos sin nombre excepto "Impacto presupuestal".
- **Interactivos (decisión, confirmación):** área de decisión con fondo `bg-surface`, botones semánticos con color propio (aprobar=teal, rechazar=ruby, excepción=violet). Botones destructivos siempre muestran el monto: "Confirmar pago · $48,313.00".
- **Checklist/goals:** barra de progreso + lista lineal con ícono circular ok/fail + acción inline por ítem. Botón primario deshabilitado hasta completar.

### Formularios
Organizados en secciones con `.form-section-title` (uppercase 10px, border-bottom). Grid de 2 columnas `.fg`. Labels en `text-3` sin uppercase excesivo. Siempre mostrar `.f-hint` cuando el campo tiene implicaciones no obvias. Estados de error con `border-color: ruby` + `.f-hint.error`.

### Tabs
Pill tabs en contenedor `bg-surface` con border. Tab activo: fondo `bg-card` + texto `accent-text` + sombra + border. Puede incluir conteo numérico en `.tab-count`.

### Empty states
Dos variantes: **primera vez** (ícono 40px + título + descripción + botón de acción, padding 44px) y **sin resultados de filtro** (compacto, padding 28px, botón "Limpiar filtros" en vez de crear nuevo).

### Toasts
Flotantes, esquina inferior derecha. Barra de color izquierda por variante. Título + descripción en dos líneas. Barra de progreso animada de duración. Botón ✕ para cerrar manualmente. Usar `.toast-v2` + `.toast-stack-v2`.

### Lo que NO se hace en UI
- No uses colores semánticos para decoración — solo para comunicar estado real.
- No pongas más de 6 columnas en una tabla.
- No uses `<br>` en notices ni toasts — reescribe el texto para que quepa en una línea.
- No repitas información: si el folio está en el header del modal, no lo pongas también en el body.
- No crees clases de un solo uso con estilos inline que dupliquen lo que ya está en `ux2_shared.css`.
- No uses hex directamente — siempre variables CSS.

## Lo que NO debes hacer
- No toques `main` directamente
- No instales dependencias npm (no hay bundler)
- No agregues CDNs sin consenso del equipo
- No modifiques `config.js` con keys distintas
- No hagas `git push --force` en `dev` ni en `main`
