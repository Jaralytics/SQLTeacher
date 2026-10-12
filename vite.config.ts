import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Rutas relativas para que funcione bajo /<repo>/ en GitHub Pages
  base: './',
  plugins: [react()],
})
