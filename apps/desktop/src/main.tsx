import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@ai-video/design-tokens/tokens.css";
import "@ai-video/plugin-video-edit/styles.css";
import "@ai-video/ui-web/styles.css";
import "@ai-video/ui-web/studio.css";
import "@ai-video/components/styles.css";

document.documentElement.classList.toggle("tauri-runtime", "__TAURI_INTERNALS__" in window);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
