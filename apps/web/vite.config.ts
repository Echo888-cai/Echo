import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Legacy backend (server.js) listens on process.env.PORT || 4173. Proxy
// /api so the new frontend can talk to the real running backend during
// development without duplicating any server-side logic.
//
// NOTE: deliberately only reads BACKEND_PORT, never plain PORT — dev-server
// launchers (this repo's .claude/launch.json, Vite itself, etc.) commonly
// set PORT to configure the *frontend* dev server's own port, which would
// collide with this lookup and make the proxy target itself (ECONNREFUSED).
const backendPort = process.env.BACKEND_PORT || 4173;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // @echo/contracts has no build output / package "main" yet (it's a
      // source-only descriptive contract layer per its own package.json
      // description) — point straight at its TS source, mirroring the
      // tsconfig "paths" mapping below so tsc and Vite agree.
      "@echo/contracts": fileURLToPath(
        new URL("../../packages/contracts/src/index.ts", import.meta.url)
      )
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          tanstack: ["@tanstack/react-query", "@tanstack/react-router"],
          validation: ["zod"]
        }
      }
    }
  }
});
