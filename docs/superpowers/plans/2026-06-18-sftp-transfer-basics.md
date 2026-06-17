# SFTP 传输基础能力 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 SFTP 页面补齐单文件上传、单文件下载和基础传输队列显示。

**Architecture:** 前端继续由 `SftpWorkspace` 管理当前 SFTP 会话和目录状态，通过 Tauri dialog 插件选择本地文件或保存位置，再调用 Rust 后端基于 `sftp_session_id` 执行传输。传输队列先保存在当前 SFTP 标签页内存状态中，只显示任务名称、方向、状态和错误信息，不做持久化、取消、并发限制或断点续传。

**Tech Stack:** React 19、Vitest、Tauri 2、`@tauri-apps/plugin-dialog`、Rust、`ssh2::Sftp`。

---

### Task 1: 接入 Tauri Dialog 插件

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Create: `src/lib/fileDialog.ts`

- [ ] **Step 1: 添加依赖**

Run: `pnpm add @tauri-apps/plugin-dialog`

Expected: `package.json` 和 `pnpm-lock.yaml` 增加 `@tauri-apps/plugin-dialog`。

- [ ] **Step 2: 添加 Rust 插件依赖**

Modify `src-tauri/Cargo.toml`:

```toml
tauri-plugin-dialog = "2"
```

- [ ] **Step 3: 初始化插件**

Modify `src-tauri/src/lib.rs`:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_dialog::init())
```

- [ ] **Step 4: 封装前端文件对话框**

Create `src/lib/fileDialog.ts`:

```ts
import { open, save } from "@tauri-apps/plugin-dialog";

export async function pickUploadFile() {
  const selected = await open({
    multiple: false,
    directory: false,
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickDownloadPath(defaultPath: string) {
  const selected = await save({
    defaultPath,
  });
  return typeof selected === "string" ? selected : null;
}
```

- [ ] **Step 5: 运行类型检查**

Run: `pnpm build`

Expected: build succeeds. Existing bundle size warning is acceptable.

### Task 2: 前端上传/下载交互

**Files:**
- Modify: `src/features/sftp/SftpWorkspace.tsx`
- Modify: `src/features/sftp/SftpWorkspace.test.tsx`
- Modify: `src/features/sftp/TransferQueue.tsx`

- [ ] **Step 1: 写上传测试**

Add to `src/features/sftp/SftpWorkspace.test.tsx`:

```ts
vi.mock("../../lib/fileDialog", () => ({
  pickUploadFile: vi.fn(),
  pickDownloadPath: vi.fn(),
}));

it("uploads a selected local file into the current directory", async () => {
  mockOpenSession();
  pickUploadFileMock.mockResolvedValue("C:\\Users\\ttat\\Desktop\\app.log");
  callBackendMock.mockResolvedValueOnce(undefined);
  callBackendMock.mockResolvedValueOnce([]);

  render(<SftpWorkspace connectionId="prod-web-01" />);

  await waitForInitialLoad();
  await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByLabelText("SFTP 文件列表") });
  await userEvent.click(screen.getByRole("menuitem", { name: "上传文件" }));

  await waitFor(() => {
    expect(callBackendMock).toHaveBeenCalledWith("upload_sftp_file", {
      request: {
        session_id: "sftp-session-1",
        local_path: "C:\\Users\\ttat\\Desktop\\app.log",
        remote_path: "/app.log",
      },
    });
  });
  expect(await screen.findByText("app.log")).toBeInTheDocument();
  expect(screen.getByText("上传完成")).toBeInTheDocument();
});
```

Run: `pnpm vitest run src/features/sftp/SftpWorkspace.test.tsx --environment jsdom`

Expected: fails because `../../lib/fileDialog` and `upload_sftp_file` flow are not implemented.

- [ ] **Step 2: 写下载测试**

Add to `src/features/sftp/SftpWorkspace.test.tsx`:

```ts
it("downloads a remote file to the selected local path", async () => {
  mockOpenSession([
    {
      name: "app.log",
      path: "/app.log",
      kind: "file",
      size: 128,
    },
  ]);
  pickDownloadPathMock.mockResolvedValue("C:\\Users\\ttat\\Downloads\\app.log");
  callBackendMock.mockResolvedValueOnce(undefined);

  render(<SftpWorkspace connectionId="prod-web-01" />);

  await waitForInitialLoad();
  await userEvent.pointer({ keys: "[MouseRight]", target: await screen.findByText("app.log") });
  await userEvent.click(screen.getByRole("menuitem", { name: "下载" }));

  await waitFor(() => {
    expect(callBackendMock).toHaveBeenCalledWith("download_sftp_file", {
      request: {
        session_id: "sftp-session-1",
        remote_path: "/app.log",
        local_path: "C:\\Users\\ttat\\Downloads\\app.log",
      },
    });
  });
  expect(screen.getByText("下载完成")).toBeInTheDocument();
});
```

Run: `pnpm vitest run src/features/sftp/SftpWorkspace.test.tsx --environment jsdom`

Expected: fails because download flow is not implemented.

- [ ] **Step 3: 实现传输状态类型和队列显示**

Modify `src/features/sftp/TransferQueue.tsx`:

```tsx
export interface TransferTask {
  id: string;
  name: string;
  direction: "upload" | "download";
  status: "running" | "completed" | "failed";
  error?: string;
}

export function TransferQueue({ tasks = [] }: { tasks?: TransferTask[] }) {
  return (
    <section aria-label="传输队列" className="transfer-queue">
      <h3>传输队列</h3>
      {tasks.length ? (
        <ul>
          {tasks.map((task) => (
            <li key={task.id}>
              <span>{task.name}</span>
              <span>{task.direction === "upload" ? "上传" : "下载"}</span>
              <span>{task.status === "running" ? "传输中" : task.status === "completed" ? `${task.direction === "upload" ? "上传" : "下载"}完成` : "传输失败"}</span>
              {task.error ? <span>{task.error}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p>暂无传输任务</p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: 实现上传/下载调用**

Modify `src/features/sftp/SftpWorkspace.tsx`:

```ts
import { pickDownloadPath, pickUploadFile } from "../../lib/fileDialog";
import { TransferQueue, type TransferTask } from "./TransferQueue";
```

Add helpers:

```ts
function localFileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "未命名文件";
}
```

Add state and functions:

```ts
const [transferTasks, setTransferTasks] = useState<TransferTask[]>([]);

function updateTransferTask(id: string, patch: Partial<TransferTask>) {
  setTransferTasks((tasks) => tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)));
}

async function uploadFile() {
  if (!sessionId) return;
  const localPath = await pickUploadFile();
  if (!localPath) return;
  const name = localFileName(localPath);
  const taskId = crypto.randomUUID();
  const remotePath = joinRemotePath(path, name);
  setTransferTasks((tasks) => [{ id: taskId, name, direction: "upload", status: "running" }, ...tasks]);
  try {
    await callBackend("upload_sftp_file", {
      request: { session_id: sessionId, local_path: localPath, remote_path: remotePath },
    });
    updateTransferTask(taskId, { status: "completed" });
    await refresh();
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    updateTransferTask(taskId, { status: "failed", error: message });
    setError(message);
  }
}

async function downloadFile(entry: SftpEntry) {
  if (!sessionId) return;
  const localPath = await pickDownloadPath(entry.name);
  if (!localPath) return;
  const taskId = crypto.randomUUID();
  setTransferTasks((tasks) => [{ id: taskId, name: entry.name, direction: "download", status: "running" }, ...tasks]);
  try {
    await callBackend("download_sftp_file", {
      request: { session_id: sessionId, remote_path: entry.path, local_path: localPath },
    });
    updateTransferTask(taskId, { status: "completed" });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    updateTransferTask(taskId, { status: "failed", error: message });
    setError(message);
  }
}
```

Wire menus:

```ts
{ label: "上传文件", onSelect: () => void uploadFile() }
{ label: "下载", onSelect: () => void downloadFile(entry) }
```

Render queue:

```tsx
<TransferQueue tasks={transferTasks} />
```

- [ ] **Step 5: 运行前端测试**

Run: `pnpm vitest run src/features/sftp/SftpWorkspace.test.tsx --environment jsdom`

Expected: all SFTP tests pass.

### Task 3: Rust 后端上传/下载命令

**Files:**
- Modify: `src-tauri/src/models/sftp.rs`
- Modify: `src-tauri/src/commands/sftp.rs`
- Modify: `src-tauri/src/ssh/sftp_manager.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/tests/sftp_session_tests.rs`

- [ ] **Step 1: 写缺失会话测试**

Add to `src-tauri/src/tests/sftp_session_tests.rs`:

```rust
#[tokio::test]
async fn transfer_operations_reject_missing_sftp_session() {
    let manager = SftpSessionManager::default();

    let upload_error = manager
        .upload_file("missing", "C:/tmp/local.txt", "/remote.txt")
        .await
        .unwrap_err();
    assert!(upload_error.to_string().contains("sftp session not found"));

    let download_error = manager
        .download_file("missing", "/remote.txt", "C:/tmp/local.txt")
        .await
        .unwrap_err();
    assert!(download_error.to_string().contains("sftp session not found"));
}
```

Run: `pnpm test:rust`

Expected: fails because `upload_file` and `download_file` do not exist.

- [ ] **Step 2: 新增请求模型**

Modify `src-tauri/src/models/sftp.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpUploadFileRequest {
    pub session_id: String,
    pub local_path: String,
    pub remote_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpDownloadFileRequest {
    pub session_id: String,
    pub remote_path: String,
    pub local_path: String,
}
```

- [ ] **Step 3: 新增 manager 方法**

Modify `src-tauri/src/ssh/sftp_manager.rs`:

```rust
pub async fn upload_file(
    &self,
    session_id: &str,
    local_path: &str,
    remote_path: &str,
) -> SessionResult<()> {
    let local_path = PathBuf::from(local_path);
    self.with_sftp(session_id, |sftp| {
        let mut local_file = std::fs::File::open(&local_path)?;
        let mut remote_file = sftp.create(Path::new(remote_path))?;
        std::io::copy(&mut local_file, &mut remote_file)?;
        Ok(())
    })
    .await
}

pub async fn download_file(
    &self,
    session_id: &str,
    remote_path: &str,
    local_path: &str,
) -> SessionResult<()> {
    let local_path = PathBuf::from(local_path);
    self.with_sftp(session_id, |sftp| {
        let mut remote_file = sftp.open(Path::new(remote_path))?;
        let mut local_file = std::fs::File::create(&local_path)?;
        std::io::copy(&mut remote_file, &mut local_file)?;
        Ok(())
    })
    .await
}
```

Also change `with_sftp` operation error type to accept `SftpSessionError` so both `ssh2::Error` and `std::io::Error` can be returned.

- [ ] **Step 4: 新增 Tauri 命令并注册**

Modify `src-tauri/src/commands/sftp.rs`:

```rust
#[tauri::command]
pub async fn upload_sftp_file(
    sessions: State<'_, SftpSessionManager>,
    request: SftpUploadFileRequest,
) -> Result<(), String> {
    sessions
        .upload_file(&request.session_id, &request.local_path, &request.remote_path)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn download_sftp_file(
    sessions: State<'_, SftpSessionManager>,
    request: SftpDownloadFileRequest,
) -> Result<(), String> {
    sessions
        .download_file(&request.session_id, &request.remote_path, &request.local_path)
        .await
        .map_err(|error| error.to_string())
}
```

Register in `src-tauri/src/lib.rs`:

```rust
commands::sftp::upload_sftp_file,
commands::sftp::download_sftp_file,
```

- [ ] **Step 5: 运行 Rust 测试**

Run: `pnpm test:rust`

Expected: all Rust tests pass.

### Task 4: 最终验证

**Files:**
- Verify only.

- [ ] **Step 1: 前端测试**

Run: `pnpm test`

Expected: all tests pass.

- [ ] **Step 2: 前端构建**

Run: `pnpm build`

Expected: build succeeds. Existing bundle size warning is acceptable.

- [ ] **Step 3: Rust 测试**

Run: `pnpm test:rust`

Expected: all Rust tests pass.

- [ ] **Step 4: Rust Clippy**

Run: `pnpm lint:rust`

Expected: no warnings or errors.

- [ ] **Step 5: Git diff check**

Run: `git diff --check`

Expected: no whitespace errors.
