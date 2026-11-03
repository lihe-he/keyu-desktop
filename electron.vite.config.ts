import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
export default defineConfig({
 main: { build: { externalizeDeps: true } },
 preload: { build: { externalizeDeps: true, rollupOptions: { input: { index: resolve('src/preload/index.ts'), platform: resolve('src/preload/platform.ts') } } } },
 renderer: { plugins: [vue()], resolve: { alias: { '@': resolve('src/renderer/src') } } }
})
