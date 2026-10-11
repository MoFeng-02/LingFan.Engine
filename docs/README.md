# 灵泛引擎文档站（docs）

LingFan.Engine 的对外文档站，基于 [Astro](https://docs.astro.build) + [Starlight](https://starlight.astro.build) 构建，中英双语（简体中文为默认语言，挂在站点根；英文挂在 `/en/`）。

## 本地开发

```bash
pnpm install
pnpm dev          # 或 pnpm start
```

开发服务器默认在 <http://localhost:4321>。本仓库的约定是用后台模式跑 dev server：

```bash
pnpm astro dev --background   # 启动
pnpm astro dev status         # 查看状态
pnpm astro dev logs           # 查看日志
pnpm astro dev stop           # 停止
```

## 构建与预览

```bash
pnpm build        # 产物输出到 dist/
pnpm preview      # 本地预览构建产物
```

## 目录结构

```
docs/
├── public/                     # 静态资源（logo、favicon，原样拷贝到产物）
├── src/
│   ├── components/             # 覆盖 Starlight 内置组件的自绘组件
│   │   ├── Hero.astro          #   首页 hero：自绘静态 SVG「舞台追光」，零客户端 JS
│   │   ├── Footer.astro        #   三段式页脚（品牌 / 导航 / 元信息）
│   │   └── SiteTitle.astro     #   导航栏文字标识 + logo 位
│   ├── content/
│   │   ├── docs/               # 中文内容（根路由）；英文内容镜像在 docs/en/
│   │   └── i18n/               # UI 字符串（zh-CN.json / en.json）
│   ├── styles/
│   │   ├── tokens.css          #   设计令牌：原始调色板 + 语义层，唯一的色值来源
│   │   ├── base.css            #   --lf-* → --sl-* 映射层 + 全局微调
│   │   ├── components.css      #   自绘组件样式（.lf-* BEM）
│   │   └── markdown.css        #   Markdown 正文排版（限定 .sl-markdown-content）
│   ├── assets/                 # 内容页引用的图片（经 Astro 优化管线）
│   └── content.config.ts       # 内容集合定义
├── astro.config.mjs            # 站点配置：i18n、侧边栏、组件覆盖、代码高亮主题
└── package.json
```

## 内容约定

- 中文内容放在 `src/content/docs/` 下，英文内容镜像在 `src/content/docs/en/` 的同名路径；英文缺页时 Starlight 自动回退渲染中文原文并显示提示条，不会 404，因此**英文侧不要建占位文件**。
- 每页 frontmatter 必填 `title`（≤60 字符）与 `description`（≤160 字符），且 `title` 全站唯一。
- 侧边栏在 `astro.config.mjs` 中显式声明（五个顶级分组），新增页面需同步登记；域组默认折叠。
- op 指令参考按「域」组织，不按单个 op 建页。

## 视觉与样式

- 设计语言「夜幕舞台 · 单束追光」：深蓝黑底、品牌蓝 `#7aa2f7` 为唯一强调色，紫色仅用于渐变与配角。
- 色值只允许出现在 `src/styles/tokens.css`；其余文件一律通过 `--lf-*`（语义层）或 `--sl-*`（映射层）取色。
- 不引入 Tailwind：Starlight 已是变量驱动的完整主题层，定制通过覆盖 `--sl-*` 变量与官方 `components` 覆盖槽完成。
- 禁止使用 `!important`，禁止覆盖 Starlight 组件内部类名。
- 自定义 CSS 总量控制在 30KB（gzip 前）以内。

## 相关链接

- 仓库：<https://github.com/MoFeng-02/LingFan.Engine>
- Astro 文档：<https://docs.astro.build>
- Starlight 文档：<https://starlight.astro.build>
