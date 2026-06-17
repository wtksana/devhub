import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

export function readClipboardText(): Promise<string> {
  return readText();
}

export function writeClipboardText(text: string): Promise<void> {
  return writeText(text);
}
