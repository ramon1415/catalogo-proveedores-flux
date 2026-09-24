# Calidad de código en la app

Primera entrega de la tarea `86bc728hh` (auditoría #687). ESLint revisa `src/`
(TypeScript, TSX y JavaScript, incluido CONTPAQ), la configuración de la app y
los scripts de `app/scripts/`. Los archivos generados, `public/`, `dist/` y
`node_modules/` se excluyen. El bundle raíz `/legacy` y las Edge Functions
quedan fuera de esta primera entrega.

## Requisitos y comandos

Usar Node **20.19+ de la rama 20**, **22.13+ de la rama 22** o **24+**,
compatible con ESLint 10. CI instala Node 20 con `actions/setup-node`.
Las dependencias nuevas tienen versión exacta y están en el lockfile.

Desde la raíz del repositorio:

```sh
npm --prefix app ci
npm --prefix app run lint
npm --prefix app run typecheck
npm --prefix app run build
```

Para ver todos los hallazgos en JSON (sin el límite de advertencias):

```sh
npm --prefix app run lint:report -- --output-file /tmp/flux-lint.json
```

## Qué bloquea CI

El workflow `React app CI` ejecuta lint antes del typecheck y build en PRs con
cambios de app y en pushes a `dev`, `main` y `feature/carlos-*`.

- Los errores de las reglas recomendadas de JavaScript/TypeScript y
  `react-hooks/rules-of-hooks` bloquean el job.
- `no-undef` revisa JavaScript; TypeScript resuelve los nombres de TS/TSX en
  el paso obligatorio de typecheck.
- Las dependencias de efectos, `any`, variables sin uso, asignaciones inútiles
  y preservación de la causa del error empiezan como advertencias. `Error.cause`
  requiere ES2022; la app actualmente usa ES2020.
- `--max-warnings 159` bloquea un aumento del **total** de advertencias. Es un
  límite agregado: no impide sustituir una advertencia por otra. Reducirlo al
  corregir deuda; no aumentarlo para hacer pasar una entrega sin revisar el cambio.
- Las excepciones inline existentes se respetan; las que ya no sirven se reportan.
  Las dos excepciones nuevas de `no-control-regex` conservan la validación de datos
  bancarios y la limpieza de nombres de comprobantes, con su motivo en la línea.

Medición inicial sobre `dev` `af2e1b6`, con esta configuración (24-sep-2026):

| Regla                                | Advertencias |
| ------------------------------------ | -----------: |
| `@typescript-eslint/no-explicit-any` |          125 |
| `react-hooks/exhaustive-deps`        |           14 |
| `@typescript-eslint/no-unused-vars`  |            6 |
| `no-unused-vars` (JavaScript)        |            2 |
| `no-useless-assignment`              |            2 |
| `preserve-caught-error`              |            1 |
| Directivas `eslint-disable` sin uso  |            9 |
| **Total**                            |      **159** |

No se activa todavía lint con información de tipos (`no-floating-promises`,
por ejemplo). Esta entrega tampoco activa `noUnusedLocals`/`noUnusedParameters`:
esa limpieza corresponde a `86bc728pg`. Los 14 hallazgos de efectos necesitan
revisión individual de comportamiento; no corregir dependencias automáticamente.

## Formato gradual

Prettier usa comillas simples, sin punto y coma y ancho de 100 caracteres.
`eslint-config-prettier` evita reglas de estilo en conflicto. Prettier corre
por separado, sin plugin que convierta formato en errores de ESLint.

Desde `app/`, pasar archivos explícitos:

```sh
npm run format:check -- src/ruta/al/archivo.tsx
npm run format -- src/ruta/al/archivo.tsx
npm run format:check:tooling
```

CI comprueba inicialmente el formato de `eslint.config.mjs`, `.prettierrc.json`,
`package.json` y este documento. El formato del código existente sigue siendo
optativo hasta su adopción por módulo; no se reformatea toda la app ni se ejecuta
`eslint --fix` de manera masiva. Revisar el diff de cualquier corrección automática.

## Siguientes entregas

1. Reducir advertencias con cambios pequeños y sus pruebas funcionales.
2. Limpiar código sin referencias comprobadas y endurecer TypeScript (`86bc728pg`),
   conservando `/legacy` y revisando también los consumidores de las pruebas.
3. Migrar helpers RPC por módulo (`86bc728kb`), conservando errores, reintentos,
   idempotencia y valores de retorno.
