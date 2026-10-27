import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@ai-video/design-tokens/tokens.css";
import "@ai-video/ui-web/styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
