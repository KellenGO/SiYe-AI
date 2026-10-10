import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: {
    lib: { entry: 'src/index.ts', name: 'SiYeAI', formats: ['iife'], fileName: () => 'ui.js' },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'react-i18next', '@tanstack/react-query', 'siye-host'],
      output: { globals: { react: 'SiYeAIHost.react', 'react-dom': 'SiYeAIHost.dom', 'react/jsx-runtime': 'SiYeAIHost.jsx', 'react-i18next': 'SiYeAIHost.i18n', '@tanstack/react-query': 'SiYeAIHost.query', 'siye-host': 'SiYeAIHost.bridge' } }
    }
  }
});
