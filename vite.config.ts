import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const emulators = loadEnv(mode, process.cwd(), 'VITE_').VITE_USE_EMULATORS === 'true';
  return {
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
    server: {
      port: 5173,
      strictPort: true,
      proxy: emulators
        ? Object.fromEntries(
            ['/emulator/', '/identitytoolkit.googleapis.com/', '/securetoken.googleapis.com/'].map(
              (path) => [path, { target: 'http://127.0.0.1:9099', changeOrigin: true }],
            ),
          )
        : undefined,
    },
  };
});
