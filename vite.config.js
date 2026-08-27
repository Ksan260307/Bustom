import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  // Relative paths, because the desktop shell serves the build from its own
  // scheme rather than from the root of a server.
  base: './',
  server: {
    // honour the port handed to us by a launcher, fall back to vite's default
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: false,
    open: false,
    // The packaged game is hundreds of megabytes of Electron that nothing
    // here imports. Watching it costs handles and file locks for nothing —
    // and on Windows a held handle is enough to make the next build fail.
    watch: { ignored: ['**/release/**', '**/dist/**'] },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    rollupOptions: {
      // The test page is built alongside the game everywhere except a
      // release build, which is the one that gets shipped to players.
      input: mode === 'release'
        ? { main: 'index.html' }
        : { main: 'index.html', tests: 'tests.html' },
    },
  },
}));
