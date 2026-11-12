import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5341 },
  preview: { port: 5341 },
  build: { chunkSizeWarningLimit: 1600 },
});
