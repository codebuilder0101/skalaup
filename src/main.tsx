import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initI18n } from "./i18n/config";
import { initTheme } from "./lib/theme";

// Harden the DOM against browser auto-translation (Google Translate). Translation
// rewrites text nodes out from under React; React then calls removeChild/insertBefore
// on a node whose parent changed and throws "not a child of this node", crashing the
// whole screen. `translate="no"` in index.html blocks the automatic case; this guard
// makes those two calls no-op safely if it happens anyway (e.g. a user forces
// translation), so React never crashes from it. It only changes behavior in the exact
// error case (node isn't a child) — normal rendering is untouched. Standard, widely
// used workaround for the React + Google Translate incompatibility.
if (typeof Node === "function" && Node.prototype) {
  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function removeChild(child) {
    if (child.parentNode !== this) {
      if (child instanceof Node) return child;
    }
    return originalRemoveChild.apply(this, arguments as unknown as [Node]) as Node;
  } as typeof Node.prototype.removeChild;

  const originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function insertBefore(newNode, referenceNode) {
    if (referenceNode && referenceNode.parentNode !== this) {
      if (newNode instanceof Node) return newNode;
    }
    return originalInsertBefore.apply(this, arguments as unknown as [Node, Node | null]) as Node;
  } as typeof Node.prototype.insertBefore;
}

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
