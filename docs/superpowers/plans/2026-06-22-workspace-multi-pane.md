# 工作区多面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现工作区第一阶段多面板能力，支持向右/向下分割、当前聚焦面板打开新标签、空面板自动关闭。

**Architecture:** 在 `AppShell` 内把单一标签数组升级为 `WorkspacePane[] + WorkspacePanePlacement[]`。每个 pane 拥有自己的标签栏和激活标签，第一阶段所有 pane 作为工作区根容器的直接子节点渲染，并通过 CSS Grid placement 控制位置，避免分割时移动已挂载 pane 导致连接重连。

**Tech Stack:** React、TypeScript、Vitest、Testing Library、CSS Grid/Flex。

---

### Task 1: 添加第一阶段行为测试

**Files:**
- Modify: `src/app/AppShell.test.tsx`

- [ ] **Step 1: 写失败测试**

新增测试覆盖：

```ts
it("splits a tab to the right and opens new connections in the focused pane", async () => {
  settings = {
    ...createSettings(),
    connections: [
      remoteConnection,
      { ...remoteConnection, id: "stage-web-01", name: "预发 Web", host: "10.0.0.11" },
    ],
  };

  render(<AppShell />);

  await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);
  await userEvent.pointer({
    keys: "[MouseRight]",
    target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
  });
  await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));

  const panes = screen.getAllByLabelText(/^工作区面板/);
  expect(panes).toHaveLength(2);
  await userEvent.click(panes[1]);
  await userEvent.dblClick(screen.getByText("预发 Web").closest("li") as HTMLElement);

  expect(within(panes[1]).getByRole("button", { name: "预发 Web" })).toHaveAttribute("aria-pressed", "true");
  expect(within(panes[0]).queryByRole("button", { name: "预发 Web" })).not.toBeInTheDocument();
});
```

新增测试：

```ts
it("removes a split pane after its last tab closes", async () => {
  settings = {
    ...createSettings(),
    connections: [remoteConnection],
  };

  render(<AppShell />);

  await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);
  await userEvent.pointer({
    keys: "[MouseRight]",
    target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
  });
  await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));

  expect(screen.getAllByLabelText(/^工作区面板/)).toHaveLength(2);
  await userEvent.click(within(screen.getAllByLabelText(/^工作区面板/)[1]).getByRole("button", { name: /关闭 生产 Web/ }));

  expect(screen.getAllByLabelText(/^工作区面板/)).toHaveLength(1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm test -- src\app\AppShell.test.tsx
```

Expected: 新增测试失败，因为还没有 `向右拆分` 菜单和多 pane DOM。

### Task 2: 实现 pane 状态模型

**Files:**
- Modify: `src/app/AppShell.tsx`

- [ ] **Step 1: 新增类型和初始 pane**

添加 `WorkspacePane`、`WorkspaceLayoutNode`、`createInitialPane`、`findPane` 等 helper。

- [ ] **Step 2: 替换全局标签状态**

把 `workspaceTabs` 和 `activeTabId` 替换为：

```ts
const [workspacePanes, setWorkspacePanes] = useState<WorkspacePane[]>(() => [createInitialPane()]);
const [workspacePanePlacements, setWorkspacePanePlacements] = useState<WorkspacePanePlacement[]>(() => [
  createWorkspacePanePlacement("pane-1"),
]);
const [focusedPaneId, setFocusedPaneId] = useState("pane-1");
```

- [ ] **Step 3: 修改打开标签函数**

所有打开标签函数都向 `focusedPaneId` 对应 pane 写入标签，并激活该 pane。

- [ ] **Step 4: 修改关闭标签函数**

关闭标签只影响当前 pane；pane 空了且不是最后一个 pane 时移除 pane。

### Task 3: 实现分割渲染和菜单

**Files:**
- Modify: `src/app/AppShell.tsx`
- Modify: `src/styles/globals.css`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `src/i18n/locales/en-US.ts`

- [ ] **Step 1: 新增菜单文案**

添加：

```ts
"app.split_right": "向右拆分",
"app.split_down": "向下拆分",
"app.workspace_pane": "工作区面板 {index}",
```

英文：

```ts
"app.split_right": "Split right",
"app.split_down": "Split down",
"app.workspace_pane": "Workspace pane {index}",
```

- [ ] **Step 2: 标签右键菜单增加分割项**

在关闭项前添加 `向右拆分` 和 `向下拆分`。

- [ ] **Step 3: 渲染稳定 pane 列表**

工作区根容器直接渲染 pane 列表：

```tsx
<div className="workspace-root" style={{ "--workspace-pane-columns": columnCount, "--workspace-pane-rows": rowCount }}>
  {workspacePanes.map((pane) => renderWorkspacePane(pane.id))}
</div>
```

- [ ] **Step 4: 添加 CSS**

新增 `.workspace-root`、`.workspace-pane` 样式。`.workspace-root` 使用 CSS Grid，列数和行数由 placement 计算；每个 `.workspace-pane` 设置自己的 `grid-row` 和 `grid-column`。不要使用全局 `workspaceSplitDirection`，否则混合拆分时会把所有面板一起改方向。

### Task 4: 验证和文档同步

**Files:**
- Modify: `docs/当前状态与下一步.md`

- [ ] **Step 1: 更新当前状态**

记录工作区第一阶段多面板能力。

- [ ] **Step 2: 运行验证**

Run:

```powershell
pnpm test -- src\app\AppShell.test.tsx src\app\WorkspaceTabs.test.tsx
pnpm test -- src\styles\globals.test.ts
pnpm exec tsc --noEmit
git diff --check
```

Expected: 全部通过。
