import type { Config } from "tailwindcss";

/**
 * Verity design system.
 *
 * Reference: handover §2 — "serious, modern, fast, and data-dense without
 * looking like a crypto casino." Colors are declared as CSS custom properties
 * in src/app/globals.css so the whole palette can be re-themed in one place.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Surfaces, dark to light.
        base: "rgb(var(--v-base) / <alpha-value>)",
        surface: "rgb(var(--v-surface) / <alpha-value>)",
        raised: "rgb(var(--v-raised) / <alpha-value>)",
        line: "rgb(var(--v-line) / <alpha-value>)",
        // Text.
        ink: "rgb(var(--v-ink) / <alpha-value>)",
        muted: "rgb(var(--v-muted) / <alpha-value>)",
        faint: "rgb(var(--v-faint) / <alpha-value>)",
        // Semantic. `up`/`down` are directional price colors, deliberately
        // teal/amber rather than red/green so the UI stays readable for the
        // most common forms of color vision deficiency.
        up: "rgb(var(--v-up) / <alpha-value>)",
        down: "rgb(var(--v-down) / <alpha-value>)",
        accent: "rgb(var(--v-accent) / <alpha-value>)",
        warn: "rgb(var(--v-warn) / <alpha-value>)",
        // Data-state badges (§2 "Live state", §10 reliability).
        live: "rgb(var(--v-live) / <alpha-value>)",
        delayed: "rgb(var(--v-delayed) / <alpha-value>)",
        mock: "rgb(var(--v-mock) / <alpha-value>)",
        unavailable: "rgb(var(--v-unavailable) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        // Dense-table scale.
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      borderRadius: {
        card: "0.5rem",
      },
    },
  },
  plugins: [],
};

export default config;
