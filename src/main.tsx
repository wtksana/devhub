import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

void showMainWindow();

async function showMainWindow() {
  try {
    await getCurrentWindow().show();
  } catch {
    // The web preview runs outside Tauri, where no native window exists.
  }
}
