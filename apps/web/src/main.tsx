import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@ai-video/ui-web";
import "@ai-video/design-tokens/tokens.css";
import "@ai-video/ui-web/styles.css";
import "@ai-video/ui-web/studio.css";
import "@ai-video/components/styles.css";
import "./styles.css";
import "@ai-video/plugin-video-edit/styles.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(<StrictMode><ThemeProvider><App /></ThemeProvider></StrictMode>);
