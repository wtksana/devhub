import { callBackend } from "./tauri";

export type FrontendLogLevel = "debug" | "info" | "warn" | "error";

export interface FrontendLogEntry {
  level: FrontendLogLevel;
  module: string;
  action: string;
  target?: string;
  result?: string;
  message?: string;
  error?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function logFrontendEvent(entry: FrontendLogEntry): Promise<void> {
  try {
    await callBackend<void>("write_app_log", { entry });
  } catch {
    // 日志失败不能影响业务操作。
  }
}

export function logFrontendError(
  module: string,
  action: string,
  error: unknown,
  target?: string,
  metadata?: FrontendLogEntry["metadata"],
): Promise<void> {
  return logFrontendEvent({
    level: "error",
    module,
    action,
    target,
    result: "failed",
    error: errorMessage(error),
    metadata,
  });
}
