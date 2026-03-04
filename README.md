# TiddlyWiki Meta Sync Changelog

## 缘起

TiddlyWiki 对 MD 文件支持较好，但其使用的是单独的 meta 文件来保存属性，而在 Obsidian 中，MD 文件的属性是由 YAML 格式来保存的。我想用 TiddlyWiki 来进行展示数据，用 Obsidian 进行编辑。毕竟 Obsidian 插件多，编辑体验也确实更丝滑一些。我简单搜索了一下，也问了 AI，社区里没有这种插件。我便想到用 gemimi 和 grok 来制作，前者几乎写不出啥来，后者则写了个 python 代码，其成功运行了。所以便一直用 grok 来跟进后续制作。

## 使用

使用方式非常简单，把仓库下的 manifest.json 和 main.js 保存在 Obsidian 的插件文件夹中。类似于下面这样。然后重启 Obsidian，找到第三方插件，就可以启动了。

```
\.obsidian\plugins\tiddlywiki-meta-sync
```

## 思路

因为 Obsidian 中要编辑属性就要有 YAML 文件。所以我的思路很简单，用插件去检测当前 MD 是否处于 Obsidian 的编辑状态，处于就把 meta 文件中的属性复制到 MD 中，然后用户正常编辑。编辑完了自动保存 MD 的过程，把 yaml 内容转换到 meta 中，并且清除。我估计应该没有什么性能压力，因为每次检测都只有一个文件。即使是多个标签页也基本上不受影响。

## 开发

使用`pnpm`

```
pnpm install
pnpm run build
```

---

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
