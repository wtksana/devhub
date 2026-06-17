import { getCurrentWindow } from "@tauri-apps/api/window";

export function getSafeCurrentWindow() {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}
