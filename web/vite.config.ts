import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** in development, serve /login like the real server does */
const loginRoute = (): Plugin => ({
  name: 'login-route',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/login' || req.url?.startsWith('/login?')) req.url = '/login.html';
      next();
    });
  }
});

export default defineConfig({
  root: import.meta.dirname,
  plugins: [loginRoute()],
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { input: { index: resolve(import.meta.dirname, 'index.html'), login: resolve(import.meta.dirname, 'login.html') } }
  },
  server: {
    port: 5173,
    // the API, uploaded files and the health check come from the Node server (npm run dev:server)
    proxy: { '/api': 'http://localhost:3000', '/files': 'http://localhost:3000', '/health': 'http://localhost:3000' }
  }
});
