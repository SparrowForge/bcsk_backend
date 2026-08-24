import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Services read JWT_SECRET at construction; requiredSecret throws without one (SEC-1).
    env: { JWT_SECRET: "test-secret-at-least-32-characters-long-xxxx" },
    coverage: { provider: "v8", include: ["src/**"], reporter: ["text"] },
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});
