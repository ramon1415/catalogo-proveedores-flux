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

## Navegación y pantallas móviles

Hasta 760 px, o en dispositivos con puntero táctil principal sin hover, el menú
se abre con un botón en la cabecera. Usa un `dialog` modal nativo para retener el
foco, impedir interacción con el fondo y devolver el foco al cerrar. Cierra con
Escape, el botón, el fondo o un enlace; los eventos de modales de empresa anidados
no cierran el menú. En escritorio el rail también se expande al recibir foco.
La empresa activa permanece accesible en la cabecera móvil.

La estructura usa altura dinámica y áreas seguras. Los controles táctiles tienen
44 px de altura mínima y los campos de texto 16 px. Solicitudes/Reembolsos tienen
formulario apilado, modales con contenido desplazable y tabla con desplazamiento
propio; Aprobaciones apila tarjetas sin encerrar las columnas en otra ventana de
scroll. Cortes y Batch conservan sus flujos, con ajustes de espacio y controles.

QA móvil pendiente: 320/390/430 px, orientación horizontal, teclado abierto,
nombres de empresa largos, selector dentro del menú, cancelar instalación,
adjuntar y abrir archivos, y navegación con teclado/lector de pantalla. Comprobar
las operaciones autenticadas con datos de prueba antes de promover a producción.

Validación de desarrollo: build/TypeScript y paquete PWA correctos. En un entorno
DOM simulado con datos ficticios se comprobaron apertura y cierre del menú,
selección de ruta, eventos de empresa anidados, cambio a escritorio, guía manual,
prompt de instalación pendiente, cancelación y confirmación `appinstalled`.
Estas comprobaciones no sustituyen renderizado, foco nativo ni QA en dispositivos.
Si el navegador deja pendiente su diálogo, el botón permite abrir instrucciones
sin volver a consumir el evento de instalación.
