# Instalación de Flux

El build entrega `/manifest.webmanifest` e iconos en `/pwa/`. Vercel production
genera “Flux”; previews y desarrollo generan “Flux DEV”, con iconos amarillos
marcados DEV. `id`, `start_url` y `scope` son `/` dentro de cada origen.

La aplicación se instala desde el navegador. El botón aparece en Login y en el
menú; usa `beforeinstallprompt` si el navegador lo ofrece y guía manual en caso
contrario. No muestra invitaciones automáticas. El estado instalado se confirma
con `appinstalled` o el modo standalone, y el prompt no se reutiliza.

Los iconos derivan del isotipo existente (`assets/favicon-512.png`): fondo opaco,
versiones 192/512/180 y variante maskable con el contenido dentro del área segura.
No hay service worker, caché offline ni cambios de autenticación, datos o roles.

Validación del paquete:

```sh
npm ci
npm run build
npm run check:pwa
VERCEL_ENV=production npm run build
npm run check:pwa -- production
```

En la revisión de dispositivos se debe registrar modelo, versión de sistema y
navegador, URL y commit desplegado. Pendientes de QA real: instalación Android e
iPhone, Google OAuth y retorno, reapertura/cierre de sesión, ámbito por empresa,
PDF/archivos y actualización de una instalación existente. No certificar esas
pruebas sólo por el build. El acceso requiere internet.
