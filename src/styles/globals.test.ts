import { describe, expect, it } from "vitest";

function readCssSource() {
  const processLike = (globalThis as unknown as {
    process?: {
      getBuiltinModule?: (name: string) => unknown;
    };
  }).process;
  const fs = processLike?.getBuiltinModule?.("fs") as
    | { readFileSync: (path: string, encoding: "utf8") => string }
    | undefined;

  if (!fs) {
    throw new Error("fs builtin module is not available in this test environment");
  }

  return fs.readFileSync("src/styles/globals.css", "utf8");
}

describe("global style defaults", () => {
  it("keeps CSS fallback font defaults aligned with settings defaults", () => {
    const globalsCss = readCssSource();

    expect(globalsCss).toContain("font-family: Consolas, \"Segoe UI\", sans-serif;");
    expect(globalsCss).toContain("font-size: var(--ui-font-size, 16px);");
    expect(globalsCss).toContain("font-size: var(--ui-font-size-small, 15px);");
    expect(globalsCss).toContain("font-size: var(--ui-font-size-large, 18px);");
    expect(globalsCss).toContain("font-size: var(--terminal-font-size, 14px);");
  });

  it("keeps inactive workspace panels out of display none for fast terminal tab switching", () => {
    const globalsCss = readCssSource();

    expect(globalsCss).not.toContain(".workspace-tab-panel[hidden]");
    expect(globalsCss).not.toContain(".workspace-tab-panel[hidden] {\n  display: none;");
    expect(globalsCss).toContain('.workspace-tab-panel[data-active="false"]');
    expect(globalsCss).toContain("visibility: hidden;");
    expect(globalsCss).toContain("content-visibility: hidden;");
    expect(globalsCss).toContain("contain: layout paint style;");
  });
});
