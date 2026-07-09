import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initI18n } from "./i18n/config";
import { initTheme } from "./lib/theme";

initTheme();
initI18n().then(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
