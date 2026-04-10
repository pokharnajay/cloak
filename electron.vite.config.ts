import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const isProd = process.env.NODE_ENV === 'production' || process.env.VITE_BUILD_MODE === 'production'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/main',
      minify: isProd ? 'terser' : false,
      terserOptions: isProd ? {
        compress: { passes: 2 },
        mangle: true,
        format: { comments: false },
      } : undefined,
      sourcemap: false,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
      minify: isProd ? 'terser' : false,
      terserOptions: isProd ? {
        compress: { passes: 2 },
        mangle: true,
        format: { comments: false },
      } : undefined,
      sourcemap: false,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()],
    build: {
      outDir: resolve(__dirname, 'dist/renderer'),
      minify: isProd ? 'terser' : 'esbuild',
      terserOptions: isProd ? {
        compress: {
          passes: 2,
          drop_debugger: true,
        },
        mangle: {
          toplevel: true,
        },
        format: { comments: false },
      } : undefined,
      sourcemap: false,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
})
