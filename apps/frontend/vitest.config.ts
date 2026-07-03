import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    // Generous timeouts: `turbo run check` executes every workspace task in
    // parallel, and jsdom + userEvent tests flake under that CPU contention
    // at the 5s default.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
