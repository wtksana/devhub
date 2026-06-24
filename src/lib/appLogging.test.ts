import { beforeEach, describe, expect, it, vi } from "vitest";

import { callBackend } from "./tauri";
import { logFrontendError, logFrontendEvent } from "./appLogging";

vi.mock("./tauri", () => ({
  callBackend: vi.fn(),
}));

const callBackendMock = vi.mocked(callBackend);

describe("appLogging", () => {
  beforeEach(() => {
    callBackendMock.mockReset();
  });

  it("writes frontend log entries through the backend", async () => {
    callBackendMock.mockResolvedValue(undefined);

    await logFrontendEvent({
      level: "error",
      module: "frontend.redis",
      action: "load_keys",
      target: "redis-local:db0",
      result: "failed",
      error: "network error",
      metadata: { command: "list_redis_keys" },
    });

    expect(callBackendMock).toHaveBeenCalledWith("write_app_log", {
      entry: {
        level: "error",
        module: "frontend.redis",
        action: "load_keys",
        target: "redis-local:db0",
        result: "failed",
        error: "network error",
        metadata: { command: "list_redis_keys" },
      },
    });
  });

  it("does not throw when frontend logging fails", async () => {
    callBackendMock.mockRejectedValue(new Error("logging failed"));

    await expect(
      logFrontendError("frontend.sftp", "load_directory", new Error("boom"), "/tmp"),
    ).resolves.toBeUndefined();
  });
});
