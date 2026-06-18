# SFTP 压缩与解压实现计划

**Goal:** 为 SFTP 文件管理器增加第一版远程压缩和解压缩能力。

**Architecture:** 前端在文件项右键菜单增加 `压缩`，并仅对 `.tar.gz` / `.tgz` 文件显示 `解压缩`。后端复用当前 SFTP session 持有的 SSH 连接，开临时 exec channel 在目标父目录执行 `tar` 命令，完成后刷新当前目录。

**Tech Stack:** React 19、Vitest、Tauri 2、Rust、ssh2 exec channel、远程 `tar`。

---

### Task 1: 前端菜单和命令调用

**Files:**
- Modify: `src/features/sftp/SftpWorkspace.tsx`
- Test: `src/features/sftp/SftpWorkspace.test.tsx`

- [x] 增加文件项右键菜单 `压缩`。
- [x] 对 `.tar.gz` / `.tgz` 文件显示 `解压缩`。
- [x] `压缩` 调用 `compress_sftp_path`，参数为 `session_id` 和 `path`。
- [x] `解压缩` 调用 `extract_sftp_archive`，参数为 `session_id` 和 `path`。
- [x] 命令成功后刷新当前目录，失败时显示错误。

### Task 2: Rust 命令和远程 tar 执行

**Files:**
- Modify: `src-tauri/src/models/sftp.rs`
- Modify: `src-tauri/src/commands/sftp.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/ssh/sftp_manager.rs`
- Test: `src-tauri/src/tests/sftp_session_tests.rs`

- [x] 新增 `SftpArchiveRequest`。
- [x] 新增 `compress_sftp_path` 和 `extract_sftp_archive` 命令。
- [x] `SftpSessionManager` 新增 `compress_path` 和 `extract_archive`。
- [x] 通过 SSH exec channel 执行 `cd <parent> && tar -czf <name>.tar.gz <name>`。
- [x] 通过 SSH exec channel 执行 `cd <parent> && tar -xzf <archive>`。
- [x] 新增缺失 session 的 Rust 测试。

### Task 3: 验证

**Files:**
- Verify only.

- [x] Run `pnpm vitest run src/features/sftp/SftpWorkspace.test.tsx --environment jsdom`
- [x] Run `pnpm test`
- [x] Run `pnpm build`
- [x] Run `pnpm test:rust`
- [x] Run `pnpm lint:rust`
- [x] Run `git diff --check`
