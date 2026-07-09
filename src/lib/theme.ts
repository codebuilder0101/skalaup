// Lightweight light/dark theme handling. The dark palette already exists in
// index.css under the `.dark` selector — we just toggle the class on <html> and
// persist the choice. No external theme library required.

const STORAGE_KEY = "skalaup-theme";

export type Theme = "light" | "dark";

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function setTheme(theme: Theme): void {
  if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}

// Apply the persisted theme on app start (called from main.tsx before render).
export function initTheme(): void {
  applyTheme(getStoredTheme());
}
