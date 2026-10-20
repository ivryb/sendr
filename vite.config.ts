import { resolve } from "node:path"
import { cloudflare } from "@cloudflare/vite-plugin"
import { reactRouter } from "@react-router/dev/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

export default defineConfig({
  // The Worker (worker/index.ts) is React Router's server environment.
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
  ],
  // Pre-bundle every page's dependencies at startup, instead of reloading the page each
  // time a newly visited page brings one in.
  optimizeDeps: { entries: ["src/**/*.tsx"] },
  build: {
    chunkSizeWarningLimit: 800,
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
})
