// vite.config.js
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path'; // ← Add this import

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  
  const backendHost = env.VITE_BACKEND_HOST || 'localhost';
  const backendPort = env.VITE_BACKEND_PORT || env.PORT || '8080';
  const backendProtocol = env.VITE_BACKEND_PROTOCOL || 'http';
  const target = `${backendProtocol}://${backendHost}:${backendPort}`;

  return {
    plugins: [react()],
    resolve: {
      // Configure path aliases
      alias: {
        '@': path.resolve(__dirname, './src'), // ← This is the key fix
      },
    },
    build: {
      chunkSizeWarningLimit: 2000,
    },
    server: {
      port: 5173,
      strictPort: true,
      host: true,
      proxy: {
        '^/(api|functions)': {
          target,
          changeOrigin: true,
          secure: false,
          cookieDomainRewrite: '',
          followRedirects: true,
        },
      },
    },
    base: env.VITE_BASE_PATH || '/',
  };
});