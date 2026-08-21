import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    // honour the port handed to us by a launcher, fall back to vite's default
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: false,
    open: false,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: 'index.html',
        tests: 'tests.html',
      },
    },
  },
});
