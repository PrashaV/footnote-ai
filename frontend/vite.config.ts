/**
 * vite.config.ts — Footnote frontend build configuration
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BUNDLE SIZE ANALYSIS WITH rollup-plugin-visualizer
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * To analyse the built bundle and identify heavy chunks:
 *
 *   1. Install the plugin (dev-only):
 *        npm install --save-dev rollup-plugin-visualizer
 *
 *   2. Uncomment the import and plugin entry below.
 *
 *   3. Run the production build:
 *        npm run build
 *
 *   4. Open the generated report in your browser:
 *        open dist/stats.html
 *      (or navigate to dist/stats.html in your file explorer)
 *
 *   The treemap shows every module grouped by chunk. Look for:
 *     • Unexpectedly large vendor chunks (d3, react-dom, etc.)
 *     • Modules that should be lazy-loaded but appear in the main chunk
 *     • Duplicate packages pulled in by transitive dependencies
 *
 *   5. Re-comment or remove before deploying — the stats file is ~1 MB and
 *      should not ship to production.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

// import { visualizer } from "rollup-plugin-visualizer";   // ← uncomment to enable

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),

    // ── Bundle analyser (uncomment to enable) ────────────────────────────
    // visualizer({
    //   filename: "dist/stats.html",   // output path, relative to project root
    //   open: false,                   // set to true to auto-open after build
    //   gzipSize: true,                // show gzip-compressed sizes
    //   brotliSize: true,              // show brotli-compressed sizes
    //   template: "treemap",           // "treemap" | "sunburst" | "network"
    // }),
  ],

  build: {
    // Emit a warning when any individual chunk exceeds 500 kB (gzip) so we
    // catch regressions before they reach production.
    chunkSizeWarningLimit: 500,

    rollupOptions: {
      output: {
        // Manual chunk splitting: keep react-dom and d3 in their own vendor
        // chunks so browsers can cache them independently of app code.
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "vendor-react";
          }
          if (id.includes("node_modules/d3") || id.includes("node_modules/d3-")) {
            return "vendor-d3";
          }
        },
      },
    },
  },
});
