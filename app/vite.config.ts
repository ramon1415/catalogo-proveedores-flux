import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // La SPA es la experiencia principal del mismo origen. El vanilla interno se
  // publica bajo /legacy y las ligas /app/* se redirigen conservando su ruta.
  base: '/',
  plugins: [react()],
})
