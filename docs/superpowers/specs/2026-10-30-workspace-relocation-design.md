# Workspace Relocation Design — 2026-10-30

## Intent

将 AI Video Studio 主仓库从 `/Users/yangzhe/Documents/ChatGPT/剪辑` 迁移到 `/Volumes/project/代码/ai-video-studio`，保留当前分支、未提交文件、验收材料与两个独立 Git 工作树。用户指定目标父目录，子目录按仓库名命名。

## Constraints and decision

- 原仓库约 6.2 GB，其中 `apps/desktop/src-tauri/target` 约 5.5 GB，是可重建的 Rust 编译缓存，本次不复制。
- 两个附属工作树的 `.git` 文件使用旧主仓库的绝对路径，迁移后须重定向到新主仓库 `.git/worktrees`。
- 原计划把旧路径设为新目录的符号链接；实测 Codex 沙箱拒绝符号链接形式的可写根，所有普通终端命令因此失败。为保证既有会话可继续运行，旧路径改为**实体占位目录**，内有 `README.md` 指向新仓库；原完整目录保存在 `剪辑.pre-migration-20261030`。旧路径不再是代码目录，所有开发会话须显式切到新路径。
- 现有未跟踪的验收材料与主仓库 Git 数据全部迁入目标。历史验收文档保留旧绝对路径以记录当时证据来源。

## Execution

1. 在目标卷同级暂存目录用 `rsync -a` 复制，排除 Rust 缓存；检查 Git HEAD、分支、状态和文件内容。
2. 测试会话暂停原仓库写入后执行最终同步，再在各自卷内重命名：暂存目录变正式目录，原目录变完整备份。
3. 创建旧路径实体占位目录，修复两个关联工作树 `.git` 文件的绝对路径。
4. 验证主仓库与两个工作树的 HEAD/状态、API 类型检查和 Web 生产构建。

## Acceptance and rollback

- 正式目录 `git rev-parse --show-toplevel` 返回 `/Volumes/project/代码/ai-video-studio`；HEAD 和分支与迁移前相同，`git worktree list` 有原有三项。
- 两个关联工作树均能运行 Git；正式目录的 API TypeScript 检查与 Web `tsc`/`vite build` 通过。
- 旧路径 README 明确指向正式目录，旧路径不能继续开发；Codex/IDE 需要重新打开正式目录。生产 Docker 与数据库不变。
- 完整备份保持原样。若必须回滚，先停写新目录，比较新旧变更，再恢复原目录和工作树 `.git` 指针；不得直接覆盖新的工作成果。
