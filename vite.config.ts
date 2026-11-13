import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'firebase-auth': ['firebase/app', 'firebase/auth'],
          firestore: ['firebase/firestore'],
          react: ['react', 'react-dom/client'],
        },
      },
    },
  },
  server: { port: 5173, strictPort: true },
});
