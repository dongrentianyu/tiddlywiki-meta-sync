import { App, Plugin, PluginSettingTab, Setting, TFile, Notice, TAbstractFile, WorkspaceLeaf } from 'obsidian';

interface PluginSettings {
	creator: string;
	modifier: string;
	enableEditTimeYAML: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
	creator: '马不前',
	modifier: '马不前',
	enableEditTimeYAML: true,
};

export default class TWMetaSyncPlugin extends Plugin {
	settings: PluginSettings;
	private previousActiveFile: TFile | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new TWSettingTab(this.app, this));

		// 核心事件
		this.registerEvent(this.app.vault.on('modify', (file) => this.syncToMeta(file)));
		this.registerEvent(this.app.vault.on('create', (file) => this.syncToMeta(file)));
		this.registerEvent(this.app.vault.on('delete', (file) => this.handleDelete(file)));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.handleRename(file, oldPath)));

		// 编辑/切换时 YAML 显示与清理
		this.registerEvent(this.app.workspace.on('file-open', (file) => this.handleFileOpen(file)));
		this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => this.handleActiveLeafChange(leaf)));

		// 命令
		this.addCommand({ id: 'full-meta-sync', name: '全量同步 .meta（当前编辑文件）', callback: () => this.fullSync() });
		this.addCommand({ id: 'convert-legacy-to-meta', name: '一键转换所有旧笔记到 .meta', callback: () => this.convertLegacyNotes() });

		// 启动时处理当前文件
		const initial = this.app.workspace.getActiveFile();
		if (initial?.extension === 'md' && this.settings.enableEditTimeYAML) {
			await this.ensureYAML(initial);
			this.previousActiveFile = initial;
		}

		console.log('🚀 TiddlyWiki Meta Sync v1.4.0 已启动（已彻底重构 + 关闭时强制清理）');
	}

	async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
	async saveSettings() { await this.saveData(this.settings); }

	// ==================== 核心函数 ====================
	async syncToMeta(file: TAbstractFile) {
		if (!(file instanceof TFile) || file.extension !== 'md' || file.path.includes('.obsidian') || file.path.includes('.git')) return;

		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter || {};

		// 1. 读取已有 .meta（保留历史自定义字段）
		let metaObj: Record<string, string> = {};
		const metaPath = file.path + '.meta';
		if (await this.app.vault.adapter.exists(metaPath)) {
			const content = await this.app.vault.adapter.read(metaPath);
			content.split('\n').forEach(line => {
				const i = line.indexOf(':');
				if (i > 0) metaObj[line.substring(0, i).trim()] = line.substring(i + 1).trim();
			});
		}

		// 2. 合并当前 YAML 编辑（只保留自定义字段）
		Object.entries(frontmatter).forEach(([k, v]) => {
			if (!['title', 'created', 'modified', 'creator', 'modifier', 'type'].includes(k)) {
				metaObj[k] = Array.isArray(v) ? v.join(' ') : String(v);
			}
		});

		// 3. 强制更新 TW 字段 + modified
		const title = (frontmatter.title as string) || file.basename;
		const stat = file.stat!;
		const toTWTime = (d: Date) => `${d.getFullYear()}${(d.getMonth() + 1).toString().padStart(2, '0')}${d.getDate().toString().padStart(2, '0')}${d.getHours().toString().padStart(2, '0')}${d.getMinutes().toString().padStart(2, '0')}${d.getSeconds().toString().padStart(2, '0')}${d.getMilliseconds().toString().padStart(3, '0')}`;

		metaObj.title = title;
		metaObj.created = toTWTime(new Date(stat.ctime));
		metaObj.modified = toTWTime(new Date(stat.mtime));   // 每次保存强制更新
		metaObj.creator = this.settings.creator;
		metaObj.modifier = this.settings.modifier;
		metaObj.type = 'text/markdown';

		// 写入 .meta
		const metaContent = Object.entries(metaObj).map(([k, v]) => `${k}: ${v}`).join('\n');
		await this.app.vault.adapter.write(metaPath, metaContent);
	}

	// ==================== YAML 显示与清理 ====================
	async ensureYAML(file: TFile) {
		if (!this.settings.enableEditTimeYAML) return;
		let content = await this.app.vault.read(file);
		const metaContent = await this.getMetaContent(file);
		const yamlBlock = this.metaToCustomYAML(metaContent);
		if (!yamlBlock) return;

		// 移除旧 YAML（无论是否干净）
		if (content.startsWith('---')) {
			const end = content.indexOf('---', 3);
			if (end > 0) content = content.substring(end + 3).trimStart();
		}
		await this.app.vault.modify(file, yamlBlock + content.trimStart());
	}

	async stripYAML(file: TFile) {
		let content = await this.app.vault.read(file);
		if (!content.startsWith('---')) return;
		const end = content.indexOf('---', 3);
		if (end > 0) {
			await this.app.vault.modify(file, content.substring(end + 3).trimStart());
		}
	}

	async handleFileOpen(file: TFile | null) {
		if (file?.extension === 'md' && this.settings.enableEditTimeYAML) {
			await this.ensureYAML(file);
		}
	}

	private async handleActiveLeafChange(leaf: WorkspaceLeaf | null) {
		const current = this.app.workspace.getActiveFile();
		if (this.previousActiveFile && this.previousActiveFile !== current && this.settings.enableEditTimeYAML) {
			await this.stripYAML(this.previousActiveFile);   // 切换时立即移除旧 YAML
		}
		this.previousActiveFile = current instanceof TFile ? current : null;
		if (current?.extension === 'md' && this.settings.enableEditTimeYAML) {
			await this.ensureYAML(current);
		}
	}

	// ==================== 关闭 Obsidian 时强制清理（你的备用方案）================
	async onunload() {
		new Notice('🔄 Obsidian 正在关闭，正在执行最终清理...');

		// 1. 全量同步 .meta（确保 modified 和所有自定义字段最新）
		await this.fullSync(true);

		// 2. 移除所有 YAML（让 .md 彻底干净）
		if (this.settings.enableEditTimeYAML) {
			const files = this.app.vault.getMarkdownFiles();
			for (const f of files) {
				if (!f.path.includes('.obsidian') && !f.path.includes('.git')) {
					await this.stripYAML(f);
				}
			}
		}

		// 3. 删除多余的 .meta 文件（孤儿 .meta）
		await this.deleteOrphanMeta();

		new Notice('✅ Obsidian 已完全清理！所有 YAML 已移除，多余 .meta 已删除，.meta 已最终同步。');
	}

	// ==================== 辅助函数 ====================
	async getMetaContent(file: TFile): Promise<string> {
		const p = file.path + '.meta';
		return await this.app.vault.adapter.exists(p) ? await this.app.vault.adapter.read(p) : '';
	}

	metaToCustomYAML(metaContent: string): string {
		const lines = metaContent.split('\n');
		const yaml: string[] = [];
		const tags: string[] = [];
		const exclude = new Set(['title', 'created', 'modified', 'creator', 'modifier', 'type']);

		for (const line of lines) {
			const i = line.indexOf(':');
			if (i === -1) continue;
			const k = line.substring(0, i).trim();
			if (exclude.has(k)) continue;
			const v = line.substring(i + 1).trim();
			if (k === 'tags') {
				tags.push(...v.split(/\s+/).filter(Boolean));
				continue;
			}
			yaml.push(`${k}: ${v.includes(':') || v.includes('"') ? `"${v.replace(/"/g, '\\"')}"` : v}`);
		}
		if (tags.length) {
			yaml.push('tags:');
			tags.forEach(t => yaml.push(`- ${t}`));
		}
		return yaml.length ? '---\n' + yaml.join('\n') + '\n---\n\n' : '';
	}

	async handleRename(file: TAbstractFile, oldPath: string) {
		if (!(file instanceof TFile) || file.extension !== 'md') return;
		const oldMeta = oldPath + '.meta';
		if (await this.app.vault.adapter.exists(oldMeta)) await this.app.vault.adapter.remove(oldMeta);
		await this.syncToMeta(file);
	}

	async handleDelete(file: TAbstractFile) {
		if (!(file instanceof TFile) || file.extension !== 'md') return;
		const metaPath = file.path + '.meta';
		if (await this.app.vault.adapter.exists(metaPath)) await this.app.vault.adapter.remove(metaPath);
	}

	async deleteOrphanMeta() {
		const allFiles = this.app.vault.getFiles();
		const mdSet = new Set(allFiles.filter(f => f.extension === 'md').map(f => f.path));
		let deleted = 0;
		for (const f of allFiles) {
			if (f.path.endsWith('.meta')) {
				const base = f.path.slice(0, -5);
				if (!mdSet.has(base)) {
					await this.app.vault.adapter.remove(f.path);
					deleted++;
				}
			}
		}
		if (deleted > 0) console.log(`🗑️ 已删除 ${deleted} 个多余 .meta 文件`);
	}

	async fullSync(showNotice = false) {
		const files = this.app.vault.getMarkdownFiles();
		for (const f of files) {
			if (!f.path.includes('.obsidian') && !f.path.includes('.git')) {
				await this.syncToMeta(f);
			}
		}
		if (showNotice) new Notice(`✅ 已最终同步所有 .meta 文件`);
	}

	async convertLegacyNotes() {
		await this.fullSync();
		new Notice('✅ 所有旧笔记已转换为 .meta');
	}
}

class TWSettingTab extends PluginSettingTab {
	plugin: TWMetaSyncPlugin;
	constructor(app: App, plugin: TWMetaSyncPlugin) { super(app, plugin); this.plugin = plugin; }
	display() {
		const { containerEl } = this; containerEl.empty();
		containerEl.createEl('h2', { text: 'TiddlyWiki Meta Sync 设置' });
		new Setting(containerEl).setName('Creator').setDesc('别人用时在这里改名字').addText(t => t.setValue(this.plugin.settings.creator).onChange(async v => { this.plugin.settings.creator = v; await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName('Modifier').addText(t => t.setValue(this.plugin.settings.modifier).onChange(async v => { this.plugin.settings.modifier = v; await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName('启用编辑时临时 YAML').setDesc('切换/关闭 Obsidian 时自动清理').addToggle(t => t.setValue(this.plugin.settings.enableEditTimeYAML).onChange(async v => { this.plugin.settings.enableEditTimeYAML = v; await this.plugin.saveSettings(); }));
	}
}