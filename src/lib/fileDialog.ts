import { open, save } from "@tauri-apps/plugin-dialog";

export async function pickUploadFile() {
  const selected = await open({
    multiple: false,
    directory: false,
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickUploadDirectory() {
  const selected = await open({
    multiple: false,
    directory: true,
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickDownloadPath(defaultPath: string) {
  const selected = await save({
    defaultPath,
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickDownloadDirectory() {
  const selected = await open({
    multiple: false,
    directory: true,
  });
  return typeof selected === "string" ? selected : null;
}
