/**
 * H4-* 十条版式手法应用 + H5-1 禁项
 */

import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import {
  DOCS,
  STYLE_DIR,
  blankComments,
  cssFiles,
  fail,
  pages,
  pass,
  read,
  rel,
  walk,
} from "./shared.ts";

// --- H4-* 十条版式手法应用
{
  const CSS_ALL = cssFiles.map((f) => read(f)).join("\n");
  const items = [
    [
      "H4-1",
      "覆盖 --sl-color-accent{,-low,-high} 与 --sl-hue-blue",
      /--sl-color-accent-low:\s*var\(--lf-brand-dim\)/.test(CSS_ALL) &&
        /--sl-hue-blue:\s*var\(--lf-hue-brand\)/.test(CSS_ALL),
      "未分层声明位于 common CSS 头部，见 H1-1 证据",
    ],
    [
      "H4-2",
      "背景重映射 --sl-color-bg{,-nav,-sidebar}",
      /--sl-color-bg:\s*var\(--lf-bg\)/.test(CSS_ALL) &&
        /--sl-color-bg-nav/.test(CSS_ALL) &&
        /--sl-color-bg-sidebar/.test(CSS_ALL),
      "",
    ],
    [
      "H4-3",
      "自绘静态 SVG hero（无客户端脚本）",
      /lf-hero__svg|lf-hero__frame/.test(
        pages.find((p) => p.url === "/").html,
      ) &&
        !/<script[^>]*>[\s\S]{0,200}lf-hero/.test(
          pages.find((p) => p.url === "/").html,
        ),
      "Hero.astro 无 <script> 与 client:* 指令",
    ],
    [
      "H4-4",
      "三段式页脚 .lf-footer",
      /lf-footer__brand/.test(CSS_ALL) &&
        /lf-footer__heading/.test(CSS_ALL) &&
        /lf-footer__copyright/.test(CSS_ALL),
      "",
    ],
    [
      "H4-5",
      "expressiveCode 暗 tokyo-night / 亮 min-light",
      /tokyo-night/.test(read(join(DOCS, "astro.config.mjs"))) &&
        /min-light/.test(read(join(DOCS, "astro.config.mjs"))),
      "astro.config.mjs expressiveCode.themes",
    ],
    [
      "H4-6",
      "显式中文字栈 --sl-font / --sl-font-mono",
      /--sl-font:\s*var\(--lf-font-sans\)/.test(CSS_ALL) &&
        /--sl-font-mono:\s*var\(--lf-font-mono\)/.test(CSS_ALL),
      "与 C4-1 同源",
    ],
    [
      "H4-7",
      "五色色相单点驱动（--sl-hue-{blue,green,red,purple,orange}）",
      ["blue", "green", "red", "purple", "orange"].every((c) =>
        new RegExp(`--sl-hue-${c}:\\s*var\\(--lf-hue-`).test(CSS_ALL),
      ),
      "",
    ],
    [
      "H4-8",
      "focus-visible 品牌环 + ::selection 品牌色",
      /:focus-visible\{outline:2px solid var\(--lf-brand\)/.test(CSS_ALL) &&
        /::selection\{background-color:var\(--lf-selection\)/.test(CSS_ALL),
      "",
    ],
    [
      "H4-9",
      "卡片 hover 发光边框（不做 translateY）",
      (() => {
        // 卡片 hover 用 1px 品牌 40% 边框 + 0 0 12px 泛光，且不做 translateY。
        // 判定范围限定「仓库自有 .lf-* 规则」：dist 里 Starlight 上游与 Pagefind UI
        // 自带 translateY(-50%/-70%) 用于居中，与卡片动效无关，全量 grep 会假阳性。
        const glowOk = cssFiles.some((f) => {
          const css = read(f);
          for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
            const sel = m[1].replace(/\s+/g, "");
            const body = m[2];
            if (
              /\.lf-|\.sl-markdown-content\.card/.test(sel) &&
              /:hover|:target/.test(sel) &&
              /--lf-glow-halo/.test(body) &&
              !/translateY/.test(body)
            )
              return true;
          }
          return false;
        });
        const lfTranslateY = cssFiles.flatMap((f) =>
          [...read(f).matchAll(/([^{}]*)\{([^{}]*)\}/g)]
            .filter((m) => /\.lf-/.test(m[1]) && /translateY/.test(m[2]))
            .map((m) => `${rel(f)}: ${m[1].replace(/\s+/g, " ").trim()}`),
        );
        return glowOk && !lfTranslateY.length;
      })(),
      "泛光规则见 components.css:356 `:where(.sl-markdown-content .card:hover)`；.lf-* 规则 0 处 translateY",
    ],
    [
      "H4-10",
      "文字标识 Logo（覆盖 SiteTitle.astro）",
      existsSync(join(DOCS, "src", "components", "SiteTitle.astro")),
      "",
    ],
  ];
  const miss = items.filter(([, , ok]) => !ok);
  if (!miss.length) {
    pass(
      "H4-1",
      "H",
      "十条版式手法全部应用",
      "必修",
      `10 条手法在 dist CSS / 配置 / 组件中逐条命中：${items.map(([id, name]) => `${id} ${name}`).join("；")}`,
      items
        .filter((i) => i[3])
        .map((i) => `${i[0]}：${i[3]}`)
        .join("；"),
    );
  } else {
    fail(
      "H4-1",
      "H",
      "十条版式手法全部应用",
      "必修",
      `${miss.length} 条未命中：${miss.map(([id, name]) => `${id} ${name}`).join("；")}`,
      items.map(([id, , ok]) => `${id}=${ok ? "ok" : "miss"}`).join(" "),
    );
  }
}

// --- H5-1 禁项：无 !important / 无页内 <style> / 无 webfont 阻塞
// 判定规则（禁项针对仓库自有 CSS）：
//   ① !important —— 只查 docs/src/styles/*.css 与 docs/src/components/*.astro 的作者样式。
//      dist 里的 1 处来自 Pagefind UI（svelte 编译产物）、13 处来自 dist/pagefind/*.css
//      第三方样式表，均非仓库自有代码。
//   ② 页内 <style> —— 禁的是「Markdown 页内行内 <style>」。dist 每页都有 1 个
//      Starlight 自注入的 <style>@layer starlight.components{…}</style>（徽标/图标变量），
//      测得 59 页中 0 页含 .lf-* 规则 ⇒ 本站作者样式全部走 customCss，未在内容里写 <style>。
//      故以「源内容文件（.md/.mdx）是否含 <style>」为判据，dist 的 <style> 单列登记。
//   ③ webfont —— 源样式与 dist 双双零 @font-face / 零字体 preload。
{
  const problems = [];
  const authorCss = [
    ...walk(STYLE_DIR).filter((f) => f.endsWith(".css")),
    ...walk(join(DOCS, "src", "components")).filter((f) => /\.astro$/.test(f)),
  ];
  const important = [];
  for (const f of authorCss) {
    // 先清空注释：仓库自有文件头注释里就写着「不使用 !important」，
    // 直接按行判定会把这句说明本身当成违规（base.css@105 等 5 处全是这种假阳性）。
    const css = blankComments(read(f));
    for (const m of css.matchAll(/!important/g)) {
      const ctx = css.slice(Math.max(0, m.index - 120), m.index + 20);
      important.push({
        file: relative(join(DOCS, "src"), f).split("\\").join("/"),
        offset: m.index,
        ctx: ctx.replace(/\s+/g, " "),
      });
    }
  }
  if (important.length)
    problems.push(`作者样式含 ${important.length} 处 !important`);

  const contentFiles = walk(join(DOCS, "src", "content")).filter((f) =>
    /\.(md|mdx)$/.test(f),
  );
  const contentInline = contentFiles
    .filter((f) => /<style\b/.test(read(f)))
    .map((f) => relative(join(DOCS, "src"), f).split("\\").join("/"));
  if (contentInline.length)
    problems.push(`Markdown/MDX 页内行内 <style>：${contentInline.join(", ")}`);

  const distInline = pages.filter((p) => /<style\b/.test(p.html));
  const distInlineOwn = distInline.filter((p) =>
    [...p.html.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g)].some((m) =>
      /\.lf-/.test(m[0]),
    ),
  );

  const webfont = [];
  for (const f of [...authorCss, ...cssFiles]) {
    for (const m of read(f).matchAll(/@font-face\s*\{[\s\S]{0,300}?\}/g))
      webfont.push(`${rel(f)}@${m.index}`);
  }
  if (webfont.length)
    problems.push(`存在 @font-face 自托管字体：${webfont.join(", ")}`);
  const fontPreload = pages
    .filter((p) => /<link[^>]+rel="preload"[^>]+as="font"/.test(p.html))
    .map((p) => p.url);
  if (fontPreload.length)
    problems.push(`页面预加载字体文件：${fontPreload.join(", ")}`);

  const thirdPartyImportant = cssFiles
    .filter((f) => !authorCss.includes(f))
    .reduce((n, f) => n + [...read(f).matchAll(/!important/g)].length, 0);
  const evidence =
    `作者样式 !important ${important.length} 处（扫描 ${authorCss.length} 个文件）；` +
    `源内容页内 <style> ${contentInline.length} 处（扫描 ${contentFiles.length} 个 .md/.mdx）；` +
    `@font-face 0 个；字体 preload 0 处。` +
    `登记：dist 中 ${distInline.length} 页含 Starlight 自注入的 <style>@layer starlight.components{…}</style>` +
    `（其中含 .lf-* 作者规则的 ${distInlineOwn.length} 页）；dist 第三方 CSS（Pagefind UI 及 dist/pagefind/*.css）自带 ${thirdPartyImportant} 处 !important`;
  if (!problems.length) {
    pass(
      "H5-1",
      "H",
      "禁项：无 !important、无页内 <style>、无 webfont 阻塞加载",
      "建议",
      evidence,
      "",
    );
  } else {
    fail(
      "H5-1",
      "H",
      "禁项：无 !important、无页内 <style>、无 webfont 阻塞加载",
      "建议",
      problems.join("；"),
      important
        .slice(0, 3)
        .map((h) => `${h.file}@${h.offset}`)
        .join(", "),
    );
  }
}
