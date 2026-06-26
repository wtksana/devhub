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

  it("keeps SQL query result grids aligned at the top", () => {
    const globalsCss = readCssSource();

    expect(globalsCss).toContain(".database-result .database-table-browser__table-shell {\n  grid-row: auto;");
    expect(globalsCss).toContain(".database-result .database-table-browser__table-wrap {\n  padding-bottom: 0;");
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
    expect(globalsCss).toContain(".workspace-pane {\n  position: absolute;\n  display: grid;\n  z-index: 3;");
    expect(globalsCss).toContain("  background: transparent;\n  pointer-events: none;");
    expect(globalsCss).toContain(".workspace-tab-panel {\n  position: absolute;\n  z-index: 2;");
    expect(globalsCss).toContain("  pointer-events: auto;\n  scrollbar-width: none;");
    expect(globalsCss).not.toContain("--workspace-pane-column-sizes");
    expect(globalsCss).not.toContain("--workspace-pane-row-sizes");
    expect(globalsCss).not.toContain(".workspace-root[data-direction=");
  });

  it("keeps dialogs inside split workspace tabs above sibling panels", () => {
    const globalsCss = readCssSource();

    expect(globalsCss).toContain(".workspace-tab-panel:has(.connection-dialog__backdrop) {\n  z-index: 30;\n}");
    expect(globalsCss).toContain(".connection-dialog__backdrop {\n  position: fixed;");
  });

  it("does not let workspace toolbar input widths override dialog form inputs", () => {
    const globalsCss = readCssSource();

    expect(globalsCss).toContain(".sftp-workspace > header input,\n.redis-workspace > header input {\n  width: min(260px, 50vw);");
    expect(globalsCss).not.toContain(".sftp-workspace input,\n.redis-workspace input {\n  width: min(260px, 50vw);");
    expect(globalsCss).toContain(".connection-form input,\n.connection-form select {\n  width: 100%;");
  });

  it("keeps table structure index dropdown checkboxes compact", () => {
    const globalsCss = readCssSource();

    expect(globalsCss).toContain(
      ".database-table-structure-dialog__field > input,\n.database-table-structure-dialog__field > label > input,\n.database-table-structure-dialog__type-input > input {",
    );
    expect(globalsCss).not.toContain(".database-table-structure-dialog__field input {\n  width: 100%;");
    expect(globalsCss).toContain(
      ".database-table-structure-dialog__index-column-menu-item input {\n  flex: 0 0 auto;\n  width: 14px;",
    );
    expect(globalsCss).toContain(".database-table-structure-dialog__field span {\n  line-height: 30px;");
    expect(globalsCss).toContain(
      ".database-table-structure-dialog__definition {\n  display: grid;\n  grid-template-columns: 78px minmax(0, 1fr);\n  align-items: center;",
    );
    expect(globalsCss).toContain(".database-table-structure-dialog__definition > span {\n  color: var(--muted);\n  line-height: 30px;");
    expect(globalsCss).toContain(
      ".database-table-structure-dialog__definition textarea {\n  min-width: 0;\n  min-height: 64px;\n  max-height: 120px;",
    );
    expect(globalsCss).toContain("resize: vertical;");
    expect(globalsCss).toContain("padding: 6px 8px;");
    expect(globalsCss).toContain("line-height: 1.45;");
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

  it("keeps icon buttons flat while using stronger icon color and hover states", () => {
    const globalsCss = readCssSource();

    expect(globalsCss).toContain(".command-palette__icon-button:hover,\n.command-palette__icon-button:focus-visible");
    expect(globalsCss).toContain(".database-icon-button:hover:not(:disabled),\n.database-icon-button:focus-visible:not(:disabled)");
    expect(globalsCss).toContain(".workspace-icon-button:hover:not(:disabled),\n.workspace-icon-button:focus-visible:not(:disabled)");
    expect(globalsCss).toContain("border-radius: 6px;");
    expect(globalsCss).toContain("border-color: transparent;");
    expect(globalsCss).toContain("background: transparent;");
    expect(globalsCss).toContain("color: var(--text);");
    expect(globalsCss).toContain("background: color-mix(in srgb, var(--button-hover) 84%, transparent);");
    expect(globalsCss).not.toContain("0 8px 18px rgb(0 0 0 / 16%)");
    expect(globalsCss).not.toContain("transform: translateY(-1px);");
    expect(globalsCss).toContain(".command-palette__icon-button:active,\n.database-icon-button:active:not(:disabled)");
    expect(globalsCss).toContain("background: color-mix(in srgb, var(--button-active) 88%, transparent);");
  });
});
