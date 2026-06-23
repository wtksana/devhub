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

  it("does not draw focus outlines around split workspace panes", () => {
    const globalsCss = readCssSource();

    expect(globalsCss).toContain(".workspace-pane {\n  position: absolute;");
    expect(globalsCss).toContain("  display: grid;");
    expect(globalsCss).not.toContain('.workspace-pane[data-focused="true"]');
    expect(globalsCss).not.toContain("outline-color: color-mix(in srgb, var(--accent) 34%, transparent);");
  });

  it("uses absolute pane geometry instead of global grid tracks for workspace panes", () => {
    const globalsCss = readCssSource();

    expect(globalsCss).toContain(".workspace-root {\n  position: relative;");
    expect(globalsCss).toContain(".workspace-pane {\n  position: absolute;");
    expect(globalsCss).not.toContain("--workspace-pane-column-sizes");
    expect(globalsCss).not.toContain("--workspace-pane-row-sizes");
    expect(globalsCss).not.toContain(".workspace-root[data-direction=");
  });

  it("renders workspace split resize handles without occupying grid tracks", () => {
    const globalsCss = readCssSource();

    expect(globalsCss).toContain("stroke='%23ffffff'");
    expect(globalsCss).toContain("stroke='%23000000'");
    expect(globalsCss).toContain("cursor: var(--cursor-col-resize);");
    expect(globalsCss).toContain("cursor: var(--cursor-row-resize);");
    expect(globalsCss).toContain(".workspace-root {\n  position: relative;");
    expect(globalsCss).toContain(".workspace-resize-handle {\n  position: absolute;");
    expect(globalsCss).toContain(".workspace-resize-handle--column {\n  width: 7px;");
    expect(globalsCss).toContain(".workspace-resize-handle--row {\n  height: 7px;");
    expect(globalsCss).toContain(".panel-resize-handle:hover,\n.panel-resize-handle:active {\n  background: transparent;");
    expect(globalsCss).not.toContain(".workspace-resize-handle::after");
    expect(globalsCss).not.toContain(".workspace-resize-handle:hover::after,\n.workspace-resize-handle:focus-visible::after");
    expect(globalsCss).not.toContain("color-mix(in srgb, var(--accent) 70%, var(--border))");
    expect(globalsCss).not.toContain("grid-template-columns: var(--workspace-pane-column-sizes, 1fr) 7px");
    expect(globalsCss).not.toContain("grid-template-rows: var(--workspace-pane-row-sizes, 1fr) 7px");
  });

  it("uses the workspace background for database object tree filters", () => {
    const globalsCss = readCssSource();

    expect(globalsCss).toContain(".database-object-tree__header {\n  display: grid;");
    expect(globalsCss).toContain("  background: var(--bg);");
    expect(globalsCss).toContain(".database-object-tree__header select,\n.database-object-tree__header input {\n  width: 100%;\n  background: var(--bg);");
  });

  it("prevents connection item text selection during double click", () => {
    const globalsCss = readCssSource();

    expect(globalsCss).toContain(".connection-list li {\n  display: grid;");
    expect(globalsCss).toContain("  user-select: none;");
  });

  it("keeps icon button hover states flat and compact", () => {
    const globalsCss = readCssSource();

    expect(globalsCss).toContain(".command-palette__icon-button:hover,\n.command-palette__icon-button:focus-visible");
    expect(globalsCss).toContain(".database-icon-button:hover:not(:disabled),\n.database-icon-button:focus-visible:not(:disabled)");
    expect(globalsCss).toContain("border-radius: 6px;");
    expect(globalsCss).toContain("background: color-mix(in srgb, var(--button-hover) 72%, transparent);");
    expect(globalsCss).not.toContain("0 8px 18px rgb(0 0 0 / 16%)");
    expect(globalsCss).not.toContain("transform: translateY(-1px);");
    expect(globalsCss).toContain(".command-palette__icon-button:active,\n.database-icon-button:active:not(:disabled)");
    expect(globalsCss).toContain("background: color-mix(in srgb, var(--button-active) 78%, transparent);");
  });
});
