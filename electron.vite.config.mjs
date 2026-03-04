import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import UnoCSS from 'unocss/vite'

export default defineConfig({
  main: {
    build: {
      sourcemap: false,
      minify: true
    }
  },
  preload: {
    build: {
      sourcemap: false,
      minify: true
    }
  },
  renderer: {
    build: {
      sourcemap: false,
      minify: true
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [UnoCSS(), react()]
  }
})
