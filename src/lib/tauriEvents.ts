import { listen } from "@tauri-apps/api/event";

export interface SftpTransferProgressPayload {
  transfer_id: string;
  progress: number;
}

export function listenSftpTransferProgress(handler: (payload: SftpTransferProgressPayload) => void) {
  if (!("__TAURI_INTERNALS__" in window)) {
    return Promise.resolve(() => undefined);
  }
  return listen<SftpTransferProgressPayload>("sftp-transfer-progress", (event) => {
    handler(event.payload);
  });
}
