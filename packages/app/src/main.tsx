import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ThemeProvider } from "@/ui";

import { App } from "./app";
import "./styles.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root — check index.html.");
}

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
