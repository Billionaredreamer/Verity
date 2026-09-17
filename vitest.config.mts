import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": src,
      /**
       * `server-only` resolves to its browser build under vitest's default
       * conditions and throws on import. Stubbing it here lets server modules
       * be unit-tested directly; the real guard is unaffected, because Next
       * enforces it at build time against the actual import graph.
       */
      "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)),
    },
  },
});
