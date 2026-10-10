import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { PageErrorBoundary } from "./components/PageRecovery";
import { recoverChunkLoad } from "./lib/page-recovery";

window.addEventListener("vite:preloadError", (event) => {
  const error = (event as Event & { payload: unknown }).payload;
  if (recoverChunkLoad(error)) event.preventDefault();
});

try {
  if (window.localStorage.getItem("theme") === "dark") {
    document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = "dark";
  }
} catch {
  // The theme provider applies the default light mode if storage is unavailable.
}

createRoot(document.getElementById("root")!).render(<PageErrorBoundary><App /></PageErrorBoundary>);
