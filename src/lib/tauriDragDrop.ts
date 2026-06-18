import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { DragDropEvent } from "@tauri-apps/api/webview";

export type LocalDragDropEvent = DragDropEvent;

export async function listenLocalDragDrop(
  handler: (event: LocalDragDropEvent) => void,
) {
  try {
    return await getCurrentWebview().onDragDropEvent((event) => {
      handler(event.payload);
    });
  } catch {
    return () => undefined;
  }
}
