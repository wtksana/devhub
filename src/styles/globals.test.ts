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

  it("keeps resize handles from occupying a visible layout column", () => {
    const globalsCss = readCssSource();

    expect(globalsCss).not.toContain("grid-template-columns: var(--connection-sidebar-width, 280px) 1px minmax(0, 1fr);");
    expect(globalsCss).not.toContain("grid-template-columns: var(--database-object-tree-width, 220px) 1px minmax(0, 1fr);");
    expect(globalsCss).toContain(".panel-resize-handle {\n  position: absolute;");
    expect(globalsCss).toContain("left: var(--connection-sidebar-width, 280px);");
    expect(globalsCss).toContain("left: var(--database-object-tree-width, 220px);");
  });

  it("keeps the database workspace layout compact", () => {
    const globalsCss = readCssSource();

    expect(globalsCss).toContain(".database-workspace__main {\n  display: grid;\n  grid-template-rows: minmax(120px, 25%) minmax(0, 1fr);\n  gap: 6px;");
    expect(globalsCss).toContain("  padding: 8px 10px;");
    expect(globalsCss).toContain(".database-workspace__content {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr);\n  gap: 6px;");
    expect(globalsCss).toContain(".database-query-panel {\n  display: grid;\n  grid-template-rows: auto minmax(0, 1fr) auto;\n  gap: 4px;");
  });

  it("keeps edited database cells visually prominent", () => {
    const globalsCss = readCssSource();

    expect(globalsCss).toContain(".database-table-browser__cell--dirty {\n  background: color-mix(in srgb, var(--accent) 30%, var(--panel)) !important;");
    expect(globalsCss).toContain("box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 82%, transparent);");
  });

  it("keeps database table rows visibly highlighted on hover", () => {
    const globalsCss = readCssSource();

    expect(globalsCss).not.toContain(".database-object-tree li:hover,\n.database-object-tree__item-button:hover {\n  background: var(--hover);");
    expect(globalsCss).toContain(".database-object-tree li:hover,\n.database-object-tree__item-button:hover {\n  background: color-mix(in srgb, var(--accent) 8%, var(--panel-raised));");
  });
});
