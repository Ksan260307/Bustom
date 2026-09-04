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
    /*
     * Source maps, always.
     *
     * A stack trace out of a 1.28 MB minified bundle is unreadable, which
     * made every crash report from a player worth nothing — and there was
     * no crash reporting either, so the two omissions hid each other.
     * `hidden` keeps the map out of the shipped file's comment: it is
     * beside the build for whoever is reading a report, and the game does
     * not advertise it.
     */
    sourcemap: 'hidden',
    // The bundle is 1.28 MB and none of it is the reason the game takes a
    // couple of seconds to start — measured at 73 ms to fetch and 32 ms to
    // compile, in the shipped shell. So this splits for CACHING rather than
    // for speed: three.js does not change when the game does.
    chunkSizeWarningLimit: 1400,
    // The stage editor is built on its own, into its own folder, by
    // `npm run stage`. It is never part of the game's build.
    outDir: mode === 'stage' ? 'dist-stage' : 'dist',
    rollupOptions: {
      /**
       * One entry, and which one depends on what is being built.
       *
       * The game runs in Electron and nowhere else, so there is no second
       * page to ship. The editor is a separate program that happens to read
       * the game's data — it must not end up inside the thing it edits, and
       * building them together is how that happens by accident.
       */
      input: mode === 'stage' ? { stage: 'stage.html' } : { main: 'index.html' },
      output: {
        manualChunks(id) {
          // Everything from node_modules in one file. It is the half of the
          // bundle that changes least, so it stays warm in the cache across
          // updates of the game itself.
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        },
      },
    },
  },
}));
