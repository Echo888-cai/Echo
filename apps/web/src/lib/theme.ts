// React port of the theme bits of src/ui/state.js — same localStorage key and
// document.documentElement.dataset.theme contract, so 00-foundation.css's
// [data-theme="dark"] rules apply unmodified.
const THEME_KEY = "echo.v3.theme";

export type Theme = "light" | "dark";

export function getTheme(): Theme {
  return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
}

/** Sets the theme and returns it — callers re-render off the return value. */
export function setTheme(theme: Theme): Theme {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
  return theme;
}

export function toggleTheme(): Theme {
  return setTheme(getTheme() === "dark" ? "light" : "dark");
}

// Apply as early as possible (module is imported at the top of main.tsx) to
// minimize the light→dark flash, mirroring state.js's top-level applyTheme call.
applyTheme(getTheme());
