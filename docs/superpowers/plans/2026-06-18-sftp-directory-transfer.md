# SFTP 文件夹传输实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 SFTP 文件管理器增加第一版文件夹上传和文件夹下载能力。

**Architecture:** 复用当前单文件传输的 Tauri dialog、SFTP session、传输队列和 `sftp-transfer-progress` 事件。文件夹传输由 Rust 后端递归执行，前端只负责选择目录、确认覆盖、展示一个总任务进度。

**Tech Stack:** React 19、Vitest、Tauri 2 dialog plugin、Rust、ssh2 SFTP。

---

### Task 1: 前端入口和覆盖确认

**Files:**
- Modify: `src/lib/fileDialog.ts`
- Modify: `src/features/sftp/SftpWorkspace.tsx`
- Test: `src/features/sftp/SftpWorkspace.test.tsx`

- [x] 增加 `pickUploadDirectory()` 和 `pickDownloadDirectory()`。
- [x] 空白区右键菜单增加 `上传文件夹`。
- [x] 文件夹右键菜单中的 `下载` 调用目录下载命令，文件仍调用单文件下载命令。
- [x] 本地文件夹名与当前远程目录同名时复用应用内覆盖确认。
- [x] 上传文件夹调用 `upload_sftp_directory`，下载文件夹调用 `download_sftp_directory`。

### Task 2: Rust 递归传输

**Files:**
- Modify: `src-tauri/src/models/sftp.rs`
- Modify: `src-tauri/src/commands/sftp.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/ssh/sftp_manager.rs`
- Test: `src-tauri/src/tests/sftp_session_tests.rs`

- [x] 新增 `SftpUploadDirectoryRequest` 和 `SftpDownloadDirectoryRequest`。
- [x] 新增 `upload_sftp_directory` 和 `download_sftp_directory` 命令。
- [x] `SftpSessionManager` 新增 `upload_directory` 和 `download_directory`。
- [x] 本地上传先扫描目录总字节数，再递归创建远程目录和上传文件。
- [x] 远程下载先递归扫描远程目录总字节数，再创建本地目录和下载文件。
- [x] 同名目录允许合并，同名文件按 `overwrite` 控制。

### Task 3: 验证

**Files:**
- Verify only.

- [x] Run `pnpm vitest run src/features/sftp/SftpWorkspace.test.tsx --environment jsdom`
- [x] Run `pnpm test`
- [x] Run `pnpm build`
- [x] Run `pnpm test:rust`
- [x] Run `pnpm lint:rust`
- [x] Run `git diff --check`
