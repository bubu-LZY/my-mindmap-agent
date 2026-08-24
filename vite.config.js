import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  optimizeDeps: {
    include: ['simple-mind-map']
  },
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true
    },
    outDir: 'web-dist',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./web/index.html', import.meta.url))
      }
    }
  }
})
