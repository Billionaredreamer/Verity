/**
 * Test stub for the `server-only` package.
 *
 * The real module throws when resolved under browser conditions, which is how
 * vitest resolves it. Next.js enforces the server boundary at build time
 * against the real import graph, so stubbing it in tests removes a resolution
 * artifact without weakening the guarantee.
 */
export {};
