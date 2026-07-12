import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initI18n } from "./i18n/config";
import { initTheme } from "./lib/theme";

initTheme();
initI18n().then(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});

// Register the PWA service worker (installability + web push). Non-blocking.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("SW registration failed", e));
  });
}
