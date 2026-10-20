import { resolve } from "node:path"
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
          ADMIN_EMAIL: "owner@example.com",
          LOGIN_CODE_RELAY_URL: "https://sendr.soy/api/login-code",
          EMAIL_PROVIDER: "memory",
        },
      },
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
      "virtual:react-router/server-build": resolve(
        import.meta.dirname,
        "./test/no-pages.ts"
      ),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
}))
