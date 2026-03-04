# TiddlyWiki Meta Sync Changelog

## [1.4.0] - 2026-03-04（最终重构版）

### Fixed

-   YAML 编辑完后**不再残留**（切换文件立即移除 + 关闭 Obsidian 强制清理）
-   关闭 Obsidian 时**自动执行完整转换**（.meta 最终同步 + 删除所有多余 .meta 文件）

### Added

-   `onunload` 强力清理流程（你要求的备用方案）
-   `deleteOrphanMeta()` 自动删除孤立 .meta 文件
-   更健壮的 YAML 注入/移除逻辑（不再依赖缓存）

### Improved

-   代码完全重构，逻辑清晰，错误处理加强
-   `modified` 每次保存强制更新，tags 和自定义字段 100% 同步

## 以前版本

-   1.3.0：修复切换不显示 + .meta 字段问题
-   1.2.0：首次实现临时 YAML
