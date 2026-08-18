import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },

  // Tauri expects a fixed port during dev
  server: {
    port: 1420,
    strictPort: true,
    // Allow connections from phone on LAN during dev
    host: '0.0.0.0',
    watch: {
      // Exclude Rust build output — Windows locks compiled .exe files
      // during cargo builds which causes EBUSY errors in Vite's watcher
      ignored: ['**/src-tauri/target/**'],
    },
  },

  // Tauri uses environment variables to know which host to use
  envPrefix: ['VITE_', 'TAURI_'],

  build: {
    // Tauri supports es2021
    target: command === 'serve' ? 'esnext' : 'es2021',
    // Don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    // Produce source maps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
    outDir: 'dist',
  },
}));
