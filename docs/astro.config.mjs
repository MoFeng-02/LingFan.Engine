// @ts-check
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
import starlight from '@astrojs/starlight';
import { satteri } from '@astrojs/markdown-satteri';
import { hastBaseLinks } from './src/plugins/hast-base-links.mjs';

/**
 * 部署基路径。**这是全站唯一出现 base 字面量的地方**：
 * `base` 选项、Markdown 链接插件、.astro 组件（经 src/utils/url.ts 读 BASE_URL）
 * 都从这里派生。换域名或改成根部署时只改这一行。
 */
const base = '/LingFan.Engine';

/**
 * 灵泛引擎对外文档站配置。
 *
 * 侧栏说明：条目默认使用 `link`（纯 URL）而不是 `slug`。Starlight 对 `slug`
 * 做存在性校验，指向尚未创建的页面会直接让构建失败；`link` 不校验，
 * 断链由 docs/scripts/audit-ia.mjs 在内容齐全后统一审计。
 * 例外：『加密与平台供给』的页面已存在（concepts/encryption.md），该条目
 * 使用 `slug`，存在性与 locale 解析交给 Starlight 构建期校验。
 *
 * op 域页 slug 是「参考」区的对外契约，与 content-reference 约定：
 * dialogue / flow / conditions / data / saves / audio / video / stage / interaction。
 */
export default defineConfig({
	site: 'https://mofeng-02.github.io',
	base,
	trailingSlash: 'always',
	build: { format: 'directory' },
	// /demo/ 内嵌真引擎 demo（一期）：把工作区源码包 alias 进 docs 构建，
	// demo 页的引擎与参考展示层直接从 packages/*/src 的 TS 直出构建
	// （两个包的 package.json exports 本就指向 src/index.ts），不给 docs 增加依赖。
	// 本节是 demo 相关的唯一配置改动，其余配置一律不动。
	vite: {
		resolve: {
			alias: {
				'@lingfan/engine': fileURLToPath(
					new URL('../packages/engine/src/index.ts', import.meta.url),
				),
				'@lingfan/ui': fileURLToPath(new URL('../packages/ui/src/index.ts', import.meta.url)),
			},
		},
	},
	// Markdown 正文里的站内链接写根绝对路径即可（例如 `/getting-started/`），
	// 构建期由 hastBaseLinks 补上 base。见 src/plugins/hast-base-links.mjs。
	markdown: {
		processor: satteri({ hastPlugins: [hastBaseLinks({ base })] }),
	},
	integrations: [
		starlight({
			title: '灵泛引擎 LingFan Engine',
			description:
				'灵泛引擎（LingFan Engine）文档：面向叙事类游戏的开源引擎与工程模板，涵盖故事 DSL、状态与变量、回溯与存档、多语言故事与 op 指令参考。',
			favicon: '/favicon.png',
			defaultLocale: 'root',
			locales: {
				root: { label: '简体中文', lang: 'zh-CN' },
				en: { label: 'English', lang: 'en' },
			},
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/MoFeng-02/LingFan.Engine',
				},
			],
			customCss: [
				'./src/styles/tokens.css',
				'./src/styles/base.css',
				'./src/styles/components.css',
				'./src/styles/markdown.css',
			],
			components: {
				Hero: './src/components/Hero.astro',
				Footer: './src/components/Footer.astro',
				SiteTitle: './src/components/SiteTitle.astro',
			},
			expressiveCode: {
				// 显式指定主题后 Starlight 不再把 --sl-* 应用到代码块 UI，
				// 代码块外框的品牌化由 src/styles/components.css 接管。
				themes: ['tokyo-night', 'min-light'],
			},
			sidebar: [
				{
					label: '开始上手',
					translations: { en: 'Getting Started' },
					items: [
						{
							label: '简介',
							translations: { en: 'Introduction' },
							link: '/introduction/',
						},
						{
							label: '快速开始',
							translations: { en: 'Quick Start' },
							link: '/getting-started/',
						},
						{
							label: '工程结构',
							translations: { en: 'Project Structure' },
							link: '/project-structure/',
						},
						{
							label: '从模板创建工程',
							translations: { en: 'Create from a Template' },
							link: '/from-template/',
						},
					],
				},
				{
					label: '核心概念',
					translations: { en: 'Core Concepts' },
					items: [
						{
							label: '故事与叙事流',
							translations: { en: 'Story & Narrative Flow' },
							link: '/concepts/story/',
						},
						{
							label: '状态与变量',
							translations: { en: 'State & Variables' },
							link: '/concepts/state/',
						},
						{
							label: '回溯与历史',
							translations: { en: 'Rollback & History' },
							link: '/concepts/rollback/',
						},
						{
							label: '存档系统',
							translations: { en: 'Save System' },
							link: '/concepts/saves/',
						},
						{
							label: '多语言故事',
							translations: { en: 'Multilingual Stories' },
							link: '/concepts/i18n/',
						},
						{
							slug: 'concepts/encryption',
							label: '加密与平台供给',
							translations: { en: 'Encryption & Platform Supply' },
						},
						{
							label: '视觉元素',
							translations: { en: 'Visual Elements' },
							link: '/concepts/elements/',
						},
						{
							label: '小游戏',
							translations: { en: 'Minigames' },
							link: '/concepts/minigame/',
						},
						{
							label: '扩展引擎',
							translations: { en: 'Extending the Engine' },
							link: '/concepts/extensions/',
						},
					],
				},
				{
					label: '指南',
					translations: { en: 'Guides' },
					collapsed: true,
					items: [
						{
							label: '编写对话与立绘',
							translations: { en: 'Writing Dialogue & Portraits' },
							link: '/guides/dialogue/',
						},
						{
							label: '菜单输入与通知',
							translations: { en: 'Menus, Input & Notifications' },
							link: '/guides/menu-input/',
						},
						{
							label: '制作多语言工程',
							translations: { en: 'Building a Multilingual Project' },
							link: '/guides/i18n/',
						},
					],
				},
				{
					label: '参考',
					translations: { en: 'Reference' },
					collapsed: true,
					items: [
						{
							label: 'op 指令参考',
							translations: { en: 'Op Reference' },
							collapsed: true,
							items: [
								{
									label: '总览',
									translations: { en: 'Overview' },
									link: '/reference/ops/',
								},
								{
									label: '对话与叙事',
									translations: { en: 'Dialogue & Narrative' },
									link: '/reference/ops/dialogue/',
								},
								{
									label: '流程与跳转',
									translations: { en: 'Flow & Jumps' },
									link: '/reference/ops/flow/',
								},
								{
									label: '条件与循环',
									translations: { en: 'Conditions & Loops' },
									link: '/reference/ops/conditions/',
								},
								{
									label: '数据与表达式',
									translations: { en: 'Data & Expressions' },
									link: '/reference/ops/data/',
								},
								{
									label: '存档',
									translations: { en: 'Saves' },
									link: '/reference/ops/saves/',
								},
								{
									label: '音频',
									translations: { en: 'Audio' },
									link: '/reference/ops/audio/',
								},
								{
									label: '视频',
									translations: { en: 'Video' },
									link: '/reference/ops/video/',
								},
								{
									label: '舞台与表现',
									translations: { en: 'Stage & Presentation' },
									link: '/reference/ops/stage/',
								},
								{
									label: '交互与小游戏',
									translations: { en: 'Interaction & Minigames' },
									link: '/reference/ops/interaction/',
								},
							],
						},
						{
							label: 'project.json 工程清单',
							translations: { en: 'project.json Manifest' },
							link: '/reference/manifest/',
						},
						{
							label: 'Resources 目录约定',
							translations: { en: 'Resources Layout' },
							link: '/reference/resources-layout/',
						},
						{
							label: '模板能力边界',
							translations: { en: 'Template Boundaries' },
							link: '/reference/template-boundaries/',
						},
					],
				},
				{
					// P1「进阶」页尚未编写，先保留 IA 位置并显式标注，
					// 避免出现指向不存在页面的死链。
					label: '进阶',
					translations: { en: 'Advanced' },
					collapsed: true,
					badge: '整理中',
					items: [],
				},
			],
		}),
	],
});
