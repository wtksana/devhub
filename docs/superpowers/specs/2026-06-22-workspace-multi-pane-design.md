# 工作区多面板设计

## 背景

当前工作区只有一组全局标签，所有 SSH、SFTP、Redis、数据库和设置页都共享同一个标签栏。后续需要支持同时查看多个终端输出、对比多个数据库表、以及为 SFTP 面板之间的文件拖拽复制打基础，因此工作区需要从单标签栏升级为多面板布局。

## 目标

- 工作区支持水平分割和竖直分割。
- 标签右键菜单提供 `向右拆分` 和 `向下拆分`。
- 分割时默认把当前标签复制为新面板里的独立标签实例。
- 新增连接标签默认打开到当前聚焦面板。
- 点击某个面板后，该面板成为当前聚焦面板。
- 关闭面板中所有标签时直接关闭空面板。
- 最后一个面板没有标签时保留为空工作区，不关闭整个工作区。

## 术语

- `pane`：工作区中的一个标签面板，拥有自己的标签列表和激活标签。
- `focusedPaneId`：当前聚焦面板，新连接和打开设置默认进入这个面板。
- `pane placement`：面板在工作区 CSS Grid 中的位置，包括行、列、行跨度和列跨度。
- `水平分割`：上下分割，对应菜单 `向下拆分`。
- `竖直分割`：左右分割，对应菜单 `向右拆分`。

## 推荐方案

第一阶段采用 `pane list + pane placement`。

- `panes` 保存每个面板的标签和激活标签，并作为工作区根容器的直接子节点渲染。
- `panePlacements` 描述每个面板在工作区网格中的区域。
- `focusedPaneId` 表示当前默认打开目标。
- 标签打开、关闭、右键菜单都接收 `paneId`，只影响对应面板。

这样做的关键约束是：分割时只追加新 pane，不改变已有 pane 的父节点和 key，避免 React 卸载已打开的终端、SFTP、Redis 或数据库面板。向右或向下拆分只修改目标 pane 以及需要跨行/跨列的相邻区域，不使用全局分割方向，避免在已有左右拆分后再向下拆分时把全部面板改成上下排列。后续如果需要拖拽调整比例或持久化复杂布局，可以在保证 pane DOM 稳定的前提下扩展 placement 数据。

## 数据模型

```ts
interface WorkspacePane {
  id: string;
  tabs: AppWorkspaceTab[];
  activeTabId: string | null;
}

type WorkspaceSplitDirection = "horizontal" | "vertical";

interface WorkspacePanePlacement {
  paneId: string;
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
}
```

`direction: "vertical"` 表示向右拆分目标区域，`direction: "horizontal"` 表示向下拆分目标区域。面板渲染仍然使用扁平 pane 列表，每个 pane 通过 placement 设置 `grid-row` 和 `grid-column`。

## 标签复制规则

分割时复制当前标签为新的独立实例：

- SSH 终端：新建同连接的新终端标签，不复用原会话。
- SFTP：新建同连接的新 SFTP 标签，不复用原会话。
- Redis：新建同连接的新 Redis 标签。
- 数据库：新建同连接的新数据库标签。
- 设置：新建设置标签；如果同 pane 已有设置标签则复用该 pane 内设置标签。

复制出来的新标签使用新的 `id`。终端、SFTP、Redis 和数据库都用已有标题作为基础，必要时追加序号，避免 React key 冲突。

## 关闭规则

- 关闭普通标签只影响所在 pane。
- `关闭其他`、`关闭左侧`、`关闭右侧` 只作用于当前 pane 的标签栏。
- 如果某个 pane 的标签全部关闭：
  - 如果还有其他 pane，则从 `panes` 中移除该 pane。
  - 如果这是最后一个 pane，则保留 pane，并显示空工作区。
- 面板被移除时，聚焦面板切换到剩余 pane 中靠后的面板。

## 第一阶段范围

第一阶段只做多面板基础能力：

- 引入 pane 状态模型。
- 标签右键支持 `向右拆分` 和 `向下拆分`。
- 新连接进入当前聚焦 pane。
- 空 pane 自动关闭。
- 面板平均分配空间。

第一阶段不做：

- 拖拽调整分割面板尺寸。
- 拖动标签到其他面板。
- SFTP 面板之间拖拽复制文件。
- 面板布局持久化到设置。

## 测试策略

- AppShell 测试覆盖分割菜单。
- AppShell 测试覆盖向右拆分后出现两个工作区面板。
- AppShell 测试覆盖点击第二个面板后，新连接打开到第二个面板。
- AppShell 测试覆盖左右拆分后再向下拆分时，只拆目标面板，不改变已有右侧面板位置。
- AppShell 测试覆盖关闭新面板内最后一个标签后，该空面板被移除。
- 现有终端、Redis、数据库、设置和标签栏测试保持通过。
