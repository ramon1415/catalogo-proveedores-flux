import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // La SPA se sirve bajo /app en el mismo origen que lo vanilla (flux.quantta.mx/app/*),
  // para compartir la sesión de Supabase. Las páginas vanilla siguen en la raíz.
  base: '/app/',
  plugins: [react()],
})
