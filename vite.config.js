import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // `npm run dev` for the pages with hot reload, `npm run dev:worker`
    // alongside for /api (the Worker in wrangler dev).
    proxy: { '/api': 'http://127.0.0.1:8787' }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
})
