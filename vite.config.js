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
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // 大依赖独立分包：主包瘦身（5.2MB → ~1.5MB），Chromium 并行加载各 chunk，
        // 且版本升级时未变化的依赖 chunk 走本地缓存，加快启动与热更新
        manualChunks(id) {
          if (id.includes('element-plus') || id.includes('@element-plus')) return 'element-plus'
          if (id.includes('simple-mind-map')) return 'simple-mind-map'
          if (id.includes('md-editor-v3')) return 'md-editor'
          if (id.includes('pdfjs-dist')) return 'pdfjs'
          if (id.includes('highlight.js')) return 'highlight'
          // 应用内巨文件独立分块（553KB 工具处理器）：与主包并行加载，主包瘦身
          if (id.replace(/\\/g, '/').includes('/src/services/toolHandler')) return 'tool-handler'
        }
      }
    }
  }
})
