import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'

const apiProxy = {
  '/api': {
    target: 'http://localhost:8765',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, ''),
  },
}

export default defineConfig({
  plugins: [react(), cesium()],
  server:  { port: 5173, proxy: apiProxy },
  preview: { port: 5173, proxy: apiProxy },
})
