import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fluxPwaPlugin } from './pwa.config.mjs'

export default defineConfig({
  // La SPA es la experiencia principal del mismo origen. El vanilla interno se
  // publica bajo /legacy y las ligas /app/* se redirigen conservando su ruta.
  base: '/',
  plugins: [react(), fluxPwaPlugin(process.env.VERCEL_ENV === 'production')],
})
