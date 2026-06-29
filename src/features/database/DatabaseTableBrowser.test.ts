import { describe, expect, it, vi } from "vitest";
import { withTablePageTimeout } from "./DatabaseTableBrowser";

describe("withTablePageTimeout", () => {
  it("rejects when the table page request hangs", async () => {
    vi.useFakeTimers();
    const request = withTablePageTimeout(new Promise(() => {}), 1000);
    const expectation = expect(request).rejects.toThrow("database table page loading timed out");

    await vi.advanceTimersByTimeAsync(1000);

    await expectation;
    vi.useRealTimers();
  });
});
