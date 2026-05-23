import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import UnoCSS from 'unocss/vite'

export default defineConfig({
  root: 'src/renderer',
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1'
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    sourcemap: false,
    minify: true
  },
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src')
    }
  },
  plugins: [UnoCSS(), react()]
})
