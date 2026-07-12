/**
 * @echo/ui — design tokens, TypeScript mirror.
 *
 * SOURCE OF TRUTH: ./tokens.css (the actual CSS custom properties that get
 * linked/@imported for real rendering). This file duplicates the LIGHT
 * (default `:root`) values only, for JS/TS consumers that need programmatic
 * access — e.g. chart color scales, canvas rendering, non-CSS contexts.
 *
 * If you change a value, change tokens.css first and mirror the edit here.
 * Do not let the two drift. Dark-mode overrides are CSS-only (driven by
 * `[data-theme="dark"]`) and are intentionally NOT duplicated here — at
 * runtime, JS consumers that need the active theme's values should read
 * them off `getComputedStyle(document.documentElement)` rather than from
 * this static object, precisely because this object only reflects light
 * mode statically.
 */

export const tokens = {
  color: {
    bg: "#f0eee6",
    bgTintA: "rgba(191, 92, 62, 0.055)",
    bgTintB: "rgba(120, 108, 84, 0.05)",
    panel: "#fcfbf8",
    panelSoft: "#f2f0e9",
    panelGlass: "rgba(252, 251, 248, 0.76)",
    panelGlassStrong: "rgba(252, 251, 248, 0.9)",

    ink: "#141413",
    ink2: "#3d3b35",
    muted: "#82807a",
    muted2: "#a3a19b",

    line: "rgba(31, 30, 24, 0.1)",
    lineStrong: "rgba(31, 30, 24, 0.16)",
    hairline: "rgba(31, 30, 24, 0.065)",

    // 陶土（book-cloth clay）accent. Named `blue` to mirror the CSS
    // custom property name (--blue), which was kept for legacy call-site
    // compatibility even though the color itself is terracotta, not blue.
    blue: "#bf5c3e",
    blueInk: "#a84e33",
    blueSoft: "rgba(191, 92, 62, 0.1)",
    amber: "#d99a2b",
    danger: "#c0392b"
  },
  shadow: {
    sh1: "0 1px 2px rgba(58, 50, 36, 0.05), 0 1px 1px rgba(58, 50, 36, 0.04)",
    sh2: "0 4px 14px rgba(58, 50, 36, 0.07), 0 1px 3px rgba(58, 50, 36, 0.05)",
    sh3: "0 18px 48px rgba(58, 50, 36, 0.11), 0 4px 14px rgba(58, 50, 36, 0.06)",
    sh4: "0 36px 90px rgba(58, 50, 36, 0.15), 0 10px 30px rgba(58, 50, 36, 0.09)"
  },
  motion: {
    ease: "cubic-bezier(0.32, 0.72, 0, 1)",
    easeOut: "cubic-bezier(0.16, 1, 0.3, 1)",
    easeSoft: "cubic-bezier(0.4, 0, 0.2, 1)",
    easeSpring: "cubic-bezier(0.34, 1.4, 0.44, 1)"
  },
  radius: {
    sm: "10px",
    md: "16px",
    lg: "22px",
    xl: "28px"
  },
  font: {
    display:
      '"Iowan Old Style", "Charter", "Palatino", Georgia, "Songti SC", "Noto Serif SC", serif',
    body:
      '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Inter, system-ui, "PingFang SC", "Hiragino Sans GB", sans-serif'
  }
} as const;

export type Tokens = typeof tokens;

/**
 * Dark-mode color overrides, mirroring `[data-theme="dark"]` in tokens.css.
 * Provided for completeness (e.g. static theme previews); prefer reading
 * live values via getComputedStyle for anything rendered on screen.
 */
export const darkTokens = {
  color: {
    bg: "#1f1e1b",
    bgTintA: "rgba(217, 119, 87, 0.08)",
    bgTintB: "rgba(224, 163, 46, 0.05)",
    panel: "#2a2925",
    panelSoft: "#32312c",
    panelGlass: "rgba(42, 41, 37, 0.76)",
    panelGlassStrong: "rgba(46, 45, 40, 0.9)",

    ink: "#f2f0e9",
    ink2: "#d6d3ca",
    muted: "#a19e94",
    muted2: "#75736b",

    line: "rgba(240, 238, 230, 0.12)",
    lineStrong: "rgba(240, 238, 230, 0.2)",
    hairline: "rgba(240, 238, 230, 0.07)",

    blue: "#d97757",
    blueInk: "#e08d6d",
    blueSoft: "rgba(217, 119, 87, 0.16)",
    amber: "#e0a32e",
    danger: "#e5695c"
  },
  shadow: {
    sh1: "0 1px 2px rgba(0, 0, 0, 0.5), 0 1px 1px rgba(0, 0, 0, 0.35)",
    sh2: "0 4px 14px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.4)",
    sh3: "0 18px 48px rgba(0, 0, 0, 0.55), 0 4px 14px rgba(0, 0, 0, 0.4)",
    sh4: "0 36px 90px rgba(0, 0, 0, 0.6), 0 10px 30px rgba(0, 0, 0, 0.5)"
  }
} as const;
