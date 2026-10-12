#!/usr/bin/env node
/**
 * audit-frontmatter.mjs · 逐页 head 与文档结构检查
 * ---------------------------------------------------------------------------
 * 覆盖界面规范 契约：
 *   A 组 · 信息架构（title 唯一且 ≤60、description ≤160 且 100% 覆盖、canonical/OG）
 *   E 组 · 无障碍（每页恰一个 h1、标题层级不跳级、landmark、装饰性 SVG、alt、焦点序）
 *   H 组 · 反模板感（每页 title 含站名）
 *
 * 度量基线：production 产物 docs/dist（`astro build` 输出）。dev server 的 HTML
 * 与 dist 不同，不得作为判据。
 *
 * 用法：
 *   cd docs && node scripts/audit-frontmatter.mjs          # 人类可读
 *   cd docs && node scripts/audit-frontmatter.mjs --json    # 机器可读（报告用）
 * 退出码：0 = 无「拦截级」失败；1 = 存在拦截级失败或 dist 缺失。
 *         「必修 / 建议」级问题只记录，不改变退出码（发布门禁 = 拦截级通过）。
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { createRequire } from "node:module";

const DIST = resolve(process.cwd(), "dist");
const JSON_OUT = process.argv.includes("--json");
const SITE_NAME = "灵泛引擎";
const SITE_ORIGIN = "https://mofeng-02.github.io/LingFan.Engine";
const TITLE_MAX = 60;
const DESC_MAX = 160;

// ---------------------------------------------------------------- 判定框架
const results = [];
const check = (id, group, name, severity, status, detail, evidence = "") =>
  results.push({ id, group, name, severity, status, detail, evidence });
const pass = (id, g, n, s, d, e) => check(id, g, n, s, "PASS", d, e);
const fail = (id, g, n, s, d, e) => check(id, g, n, s, "FAIL", d, e);
const manual = (id, g, n, s, d) => check(id, g, n, s, "MANUAL", d, "");

if (!existsSync(DIST)) {
  console.error(`[audit-frontmatter] 找不到 production 产物：${DIST}`);
  console.error("  请先执行：cd docs && npx astro build");
  process.exit(1);
}

// ---------------------------------------------------------------- 工具
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
};
const urlOf = (p) =>
  "/" +
  relative(DIST, p)
    .split("\\")
    .join("/")
    .replace(/index\.html$/, "")
    .replace(/^404\.html$/, "404/");
const decode = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
const cpLen = (s) => [...decode(s)].length;

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
/** 列出全部标签（含位置与属性），用于祖先判定 */
function tagList(html) {
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|[^>"])*?)(\/?)>/g;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    out.push({
      i: m.index,
      close: !!m[1],
      name: m[2].toLowerCase(),
      attrs: m[3],
      self: !!m[4] || VOID.has(m[2].toLowerCase()),
    });
  }
  return out;
}
/**
 * 判定某位置的元素是否已从无障碍树移除：自身或任一祖先带 aria-hidden="true"。
 * 这是 E 组「装饰性图标不得被读屏念出」的准确判据——Starlight 把 aria-hidden
 * 放在 .sl-anchor-icon 的 <span> 上，图标 <svg> 自身没有该属性。
 */
function ancestorHidden(tags, idx) {
  let depth = 0;
  for (let k = tags.length - 1; k >= 0; k--) {
    const t = tags[k];
    if (t.i >= idx) continue;
    if (t.close) depth++;
    else if (t.self) continue;
    else if (depth > 0) depth--;
    else {
      if (/aria-hidden="true"/.test(t.attrs)) return true;
      if (t.name === "body" || t.name === "html") return false;
    }
  }
  return false;
}

/**
 * 取 <main> 的内容切片。标题层级检查必须以 main 为范围：
 * 右侧 TOC 的 `<nav aria-labelledby="starlight__on-this-page">` 内含
 * `<h2 id="starlight__on-this-page">本页目录</h2>`，它按设计位于正文之前，
 * 若按整页文档序判定会得出「h2 出现在 h1 之前」的假阳性。Starlight 的侧栏
 * 与 TOC 是带可访问名的 landmark，其内部标题不参与正文大纲。
 */
function mainSlice(body) {
  const s = body.indexOf("<main");
  if (s < 0) return null;
  const re = /<main\b|<\/main>/g;
  re.lastIndex = s;
  let depth = 0;
  let m;
  while ((m = re.exec(body))) {
    if (m[0] === "<main") depth++;
    else if (--depth === 0) return body.slice(s, m.index + 7);
  }
  return body.slice(s);
}

const pages = walk(DIST).sort();
const rows = pages.map((p) => {
  const html = readFileSync(p, "utf8");
  const body = html.slice(html.indexOf("<body"));
  return {
    path: p,
    url: urlOf(p),
    en: urlOf(p).startsWith("/en/"),
    html,
    body,
    main: mainSlice(body),
    tags: tagList(body),
    title: (html.match(/<title>([\s\S]*?)<\/title>/) || [, ""])[1].trim(),
    desc: (html.match(/<meta name="description" content="([^"]*)"/) || [
      ,
      "",
    ])[1],
    canonical: (html.match(/<link rel="canonical" href="([^"]*)"/) || [
      ,
      "",
    ])[1],
    ogTitle: (html.match(/<meta property="og:title" content="([^"]*)"/) || [
      ,
      "",
    ])[1],
    ogDesc: (html.match(
      /<meta property="og:description" content="([^"]*)"/,
    ) || [, ""])[1],
    htmlLang: (html.match(/<html[^>]*\blang="([^"]*)"/) || [, ""])[1],
  };
});

// ================================================================ A · title
const titleLong = rows.filter((r) => cpLen(r.title) > TITLE_MAX);
if (!titleLong.length) {
  const max = Math.max(...rows.map((r) => cpLen(r.title)));
  pass(
    "A3-1",
    "A",
    `每页 <title> ≤ ${TITLE_MAX} 字符`,
    "拦截",
    `${rows.length} 页全部合规，最长 ${max} 字符`,
    `最长页：${rows.find((r) => cpLen(r.title) === max).url} → 「${rows.find((r) => cpLen(r.title) === max).title}」`,
  );
} else {
  fail(
    "A3-1",
    "A",
    `每页 <title> ≤ ${TITLE_MAX} 字符`,
    "拦截",
    `${titleLong.length} 页超限`,
    titleLong.map((r) => `${r.url} (${cpLen(r.title)})`).join(", "),
  );
}

for (const lang of ["zh", "en"]) {
  const set = rows.filter((r) => r.en === (lang === "en"));
  const seen = new Map();
  for (const r of set) seen.set(r.title, [...(seen.get(r.title) || []), r.url]);
  const dup = [...seen.entries()].filter(([, v]) => v.length > 1);
  const label = lang === "zh" ? "简体中文" : "English";
  if (!dup.length) {
    pass(
      `A3-2-${lang}`,
      "A",
      `${label}侧 title 唯一`,
      "拦截",
      `${set.length} 页 title 全部唯一`,
      "",
    );
  } else {
    fail(
      `A3-2-${lang}`,
      "A",
      `${label}侧 title 唯一`,
      "拦截",
      `${dup.length} 组重复`,
      dup.map(([t, v]) => `「${t}」→ ${v.join(" / ")}`).join("; "),
    );
  }
}
// en fallback 页继承 zh 的 title 属 Starlight 对应章节 预期行为，跨语言同名单独记录为信息项
{
  const seen = new Map();
  for (const r of rows)
    seen.set(r.title, [...(seen.get(r.title) || []), r.url]);
  const cross = [...seen.entries()].filter(
    ([, v]) =>
      v.length > 1 &&
      v.some((u) => u.startsWith("/en/")) &&
      v.some((u) => !u.startsWith("/en/")),
  );
  pass(
    "A3-2-x",
    "A",
    "跨语言同名 title（en fallback 继承 zh）",
    "建议",
    `${cross.length} 组：en 侧未翻译页复用 zh 的 title/description，属界面规范 声明的自动回退行为，非缺陷`,
    cross.length ? `例：「${cross[0][0]}」→ ${cross[0][1].join(" / ")}` : "",
  );
}

const noName = rows.filter((r) => !r.title.includes(SITE_NAME));
if (!noName.length) {
  pass(
    "H2-1",
    "H",
    `每页 <title> 含站名「${SITE_NAME}」`,
    "拦截",
    `${rows.length} 页全部命中`,
    "",
  );
} else {
  fail(
    "H2-1",
    "H",
    `每页 <title> 含站名「${SITE_NAME}」`,
    "拦截",
    `${noName.length} 页缺站名`,
    noName.map((r) => `${r.url} → 「${r.title}」`).join(", "),
  );
}

// ============================================================ A · description
const noDesc = rows.filter((r) => !r.desc.trim());
if (!noDesc.length) {
  pass(
    "A3-3",
    "A",
    "description 覆盖率 100%",
    "拦截",
    `${rows.length} 页全部有 <meta name="description">`,
    "",
  );
} else {
  fail(
    "A3-3",
    "A",
    "description 覆盖率 100%",
    "拦截",
    `${noDesc.length} 页缺失`,
    noDesc.map((r) => r.url).join(", "),
  );
}

const descLong = rows.filter((r) => cpLen(r.desc) > DESC_MAX);
if (!descLong.length) {
  const max = Math.max(...rows.map((r) => cpLen(r.desc)));
  pass(
    "A3-4",
    "A",
    `description ≤ ${DESC_MAX} 字符`,
    "必修",
    `${rows.length} 页全部合规，最长 ${max} 字符`,
    "",
  );
} else {
  fail(
    "A3-4",
    "A",
    `description ≤ ${DESC_MAX} 字符`,
    "必修",
    `${descLong.length} 页超限`,
    descLong.map((r) => `${r.url} (${cpLen(r.desc)} 字符)`).join(", "),
  );
}

{
  const m = new Map();
  for (const r of rows) m.set(r.desc, [...(m.get(r.desc) || []), r.url]);
  const dup = [...m.entries()].filter(([, v]) => v.length > 1);
  if (!dup.length) {
    pass(
      "A3-5",
      "A",
      "description 全局唯一",
      "建议",
      `${rows.length} 页无重复`,
      "",
    );
  } else {
    const enOnly = dup.every(([, v]) => v.every((u) => u.startsWith("/en/")));
    fail(
      "A3-5",
      "A",
      "description 全局唯一",
      "建议",
      `${dup.length} 组重复${enOnly ? "（全部为 en fallback 继承 zh，对应章节 预期行为）" : ""}`,
      dup
        .slice(0, 8)
        .map(([d, v]) => `${v.join(" / ")} ← 「${d.slice(0, 36)}…」`)
        .join("; "),
    );
  }
}

const badCanon = rows.filter((r) => !r.canonical.startsWith(SITE_ORIGIN));
if (!badCanon.length) {
  pass(
    "A3-6",
    "A",
    "canonical 指向正式站点前缀",
    "必修",
    `${rows.length} 页均以 ${SITE_ORIGIN} 开头`,
    "",
  );
} else {
  fail(
    "A3-6",
    "A",
    "canonical 指向正式站点前缀",
    "必修",
    `${badCanon.length} 页异常`,
    badCanon.map((r) => `${r.url} → ${r.canonical || "(缺失)"}`).join(", "),
  );
}

const noOg = rows.filter((r) => !r.ogTitle || !r.ogDesc);
if (!noOg.length) {
  pass(
    "A3-7",
    "A",
    "og:title / og:description 全覆盖",
    "建议",
    `${rows.length} 页齐备`,
    "",
  );
} else {
  fail(
    "A3-7",
    "A",
    "og:title / og:description 全覆盖",
    "建议",
    `${noOg.length} 页缺失`,
    noOg.map((r) => r.url).join(", "),
  );
}

// ============================================================== E · 结构与无障碍
{
  const bad = [];
  for (const r of rows) {
    const h1 = [...r.body.matchAll(/<h1\b/g)].length;
    if (h1 !== 1) bad.push(`${r.url} (h1×${h1})`);
  }
  if (!bad.length)
    pass(
      "E1-1",
      "E",
      "每页恰好一个 <h1>",
      "拦截",
      `${rows.length} 页全部恰好 1 个 h1`,
      "",
    );
  else
    fail(
      "E1-1",
      "E",
      "每页恰好一个 <h1>",
      "拦截",
      `${bad.length} 页异常`,
      bad.join(", "),
    );
}
{
  const bad = [];
  const perPage = [];
  for (const r of rows) {
    if (!r.main) {
      bad.push(`${r.url} (无 <main>)`);
      continue;
    }
    const hs = [...r.main.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    let prev = 0;
    for (const h of hs) {
      if (prev && h > prev + 1) bad.push(`${r.url} (h${prev}→h${h})`);
      prev = h;
    }
    perPage.push({ url: r.url, levels: hs });
  }
  if (!bad.length) {
    pass(
      "E1-2",
      "E",
      "正文（<main> 范围内）标题层级无跳级",
      "拦截",
      `${rows.length} 页 h1→h6 序列均连续`,
      `判定范围 = <main> 内容区；例 /reference/ops/stage → h${perPage.find((p) => p.url === "/reference/ops/stage/").levels.join(",h")}。` +
        '范围说明：右侧 TOC 的 nav 内含 `<h2 id="starlight__on-this-page">本页目录</h2>`，按设计位于正文之前，属独立 landmark，不计入正文大纲。',
    );
  } else {
    fail(
      "E1-2",
      "E",
      "正文（<main> 范围内）标题层级无跳级",
      "拦截",
      `${bad.length} 处跳级`,
      bad.slice(0, 20).join(", "),
    );
  }
}
{
  const bad = rows.filter((r) => !/<main\b/.test(r.body)).map((r) => r.url);
  if (!bad.length)
    pass(
      "E1-3",
      "E",
      "每页有 <main> landmark",
      "必修",
      `${rows.length} 页齐备`,
      "",
    );
  else
    fail(
      "E1-3",
      "E",
      "每页有 <main> landmark",
      "必修",
      `${bad.length} 页缺失`,
      bad.join(", "),
    );
}
{
  const bad = rows
    .filter((r) => !/sl-skip-link/.test(r.body))
    .map((r) => r.url);
  if (!bad.length)
    pass(
      "E1-4",
      "E",
      "每页有跳转到正文的 skip link",
      "必修",
      `${rows.length} 页齐备`,
      "",
    );
  else
    fail(
      "E1-4",
      "E",
      "每页有跳转到正文的 skip link",
      "必修",
      `${bad.length} 页缺失`,
      bad.join(", "),
    );
}
{
  // 装饰性 SVG：自身或任一祖先 aria-hidden="true"，或自带 role="img"/aria-label/<title>
  const bad = [];
  const samples = [];
  let total = 0;
  let viaAncestor = 0;
  for (const r of rows) {
    for (const m of r.body.matchAll(/<svg\b[^>]*>/g)) {
      total++;
      const tag = m[0];
      if (
        /aria-hidden="true"/.test(tag) ||
        /aria-label=|role="img"/.test(tag) ||
        /<title>/.test(r.body.slice(m.index, m.index + 300))
      )
        continue;
      if (ancestorHidden(r.tags, m.index)) {
        viaAncestor++;
        if (samples.length < 2)
          samples.push(
            `${r.url}@${m.index} 由祖先 .sl-anchor-icon[aria-hidden] 覆盖`,
          );
        continue;
      }
      bad.push(`${r.url}@${m.index}`);
    }
  }
  if (!bad.length) {
    pass(
      "E1-5",
      "E",
      "SVG 图标均从无障碍树移除或有可访问名",
      "必修",
      `${total} 个 <svg> 全部合规（其中 ${viaAncestor} 个由祖先 aria-hidden 容器覆盖，Starlight 的 .sl-anchor-icon 即此形态）`,
      samples.join("；"),
    );
  } else {
    fail(
      "E1-5",
      "E",
      "SVG 图标均从无障碍树移除或有可访问名",
      "必修",
      `${bad.length}/${total} 个 <svg> 既无 aria-hidden（自身或祖先）也无 role="img"/aria-label`,
      bad.slice(0, 12).join(", "),
    );
  }
}
{
  const bad = [];
  let total = 0;
  for (const r of rows) {
    for (const m of r.body.matchAll(/<img\b[^>]*>/g)) {
      total++;
      if (!/\balt=/.test(m[0])) bad.push(`${r.url}@${m.index}`);
    }
  }
  if (!bad.length)
    pass(
      "E1-6",
      "E",
      "所有 <img> 有 alt 属性",
      "必修",
      `${total} 个 <img> 全部带 alt`,
      "",
    );
  else
    fail(
      "E1-6",
      "E",
      "所有 <img> 有 alt 属性",
      "必修",
      `${bad.length} 个缺 alt`,
      bad.join(", "),
    );
}
{
  const bad = [];
  for (const r of rows)
    for (const m of r.html.matchAll(/tabindex="(\d+)"/g))
      if (Number(m[1]) > 0) bad.push(`${r.url} tabindex=${m[1]}`);
  if (!bad.length)
    pass(
      "E1-7",
      "E",
      "无 tabindex > 0（不打乱自然焦点顺序）",
      "必修",
      `${rows.length} 页均无正值 tabindex`,
      "",
    );
  else
    fail(
      "E1-7",
      "E",
      "无 tabindex > 0（不打乱自然焦点顺序）",
      "必修",
      `${bad.length} 处`,
      bad.join(", "),
    );
}
{
  // 口径：splash 首页（/ 与 /en/）与 404 不渲染侧栏，nav 数为 0 属预期；
  // 其余页面每个 <nav> 都必须有可访问名（aria-label 或 aria-labelledby）。
  const noNavExpected = (u) => u === "/" || u === "/en/" || u === "/404/";
  const noNav = [];
  const unnamed = [];
  let navTotal = 0;
  for (const r of rows) {
    const navs = [...r.body.matchAll(/<nav\b[^>]*>/g)].map((m) => m[0]);
    navTotal += navs.length;
    if (!navs.length) {
      if (!noNavExpected(r.url)) noNav.push(r.url);
      continue;
    }
    for (const n of navs)
      if (!/\baria-label="[^"]+"|\baria-labelledby="[^"]+"/.test(n))
        unnamed.push(`${r.url} <nav>`);
  }
  if (!unnamed.length && !noNav.length)
    pass(
      "E1-8",
      "E",
      "每个 <nav> 均有可访问名",
      "建议",
      `${rows.length} 页共 ${navTotal} 个 <nav> 全部有可访问名；splash 首页与 404 不渲染侧栏（nav=0，属预期）`,
      "",
    );
  else
    fail(
      "E1-8",
      "E",
      "每个 <nav> 均有可访问名",
      "建议",
      `${unnamed.length} 个 <nav> 缺可访问名；${noNav.length} 个内容页意外无 nav`,
      [...unnamed, ...noNav].slice(0, 8).join(", "),
    );
}
// ---------------------------------------------------------------- E2-1 键盘走查
// 静态产物无法判定真实焦点行为 ⇒ 有浏览器时做真键盘实测；缺任一前置条件则退回
// MANUAL 并写明原因（不静默判过）。
const LF_AUDIT_HOME = process.env.LF_AUDIT_HOME ?? "E:/Temp/Windows/lf-audit";
const PREVIEW =
  process.env.LF_PREVIEW ?? "http://127.0.0.1:4322/LingFan.Engine";
const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
const puppeteerPath = [join(LF_AUDIT_HOME, "package.json")].find((p) =>
  existsSync(p),
);
let live = false;
try {
  live = (await fetch(PREVIEW + "/", { signal: AbortSignal.timeout(4000) })).ok;
} catch {
  live = false;
}

let kbBrowser = null;
if (puppeteerPath && chromePath && live) {
  try {
    kbBrowser = await createRequire(puppeteerPath)("puppeteer-core").launch({
      executablePath: chromePath,
      headless: "shell",
      args: ["--no-sandbox"],
    });
  } catch {
    kbBrowser = null;
  }
}
if (kbBrowser) {
  const kbWhy = [];
  const page = await kbBrowser.newPage();
  const activeInfo = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName,
        text: (el.innerText || el.getAttribute("aria-label") || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 32),
        href: el.getAttribute("href") || "",
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
      };
    });
  const focusable = [];
  let noRing = 0;
  for (const probe of ["/guides/dialogue/", "/en/reference/ops/"]) {
    await page.goto(PREVIEW + probe, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.body.focus());
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Tab");
      const a = await activeInfo();
      if (!a) break;
      focusable.push(a);
      if (a.outlineStyle === "none" || a.outlineWidth === "0px") noRing++;
    }
    // Shift+Tab 反向必须能回到上一节点
    const before = await activeInfo();
    await page.keyboard.down("Shift");
    await page.keyboard.press("Tab");
    await page.keyboard.up("Shift");
    const after = await activeInfo();
    if (before && after && before.text === after.text)
      kbWhy.push(`${probe} Shift+Tab 未反向移动`);
  }
  // skip link：首次 Tab 命中（Starlight 内建跳转链接指向 #_top），Enter 后 URL 带 #_top
  await page.goto(PREVIEW + "/guides/dialogue/", {
    waitUntil: "domcontentloaded",
  });
  await page.keyboard.press("Tab");
  const first = await activeInfo();
  if (!first || first.href !== "#_top")
    kbWhy.push(
      `首个 Tab 焦点不是 skip link（实测「${first?.text ?? "null"}」href=${first?.href ?? "-"}）`,
    );
  else {
    await page.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 300));
    if (!page.url().includes("#_top"))
      kbWhy.push(`skip link 回车后 URL 未带 #_top（实测 ${page.url()}）`);
  }
  if (noRing) kbWhy.push(`${noRing} 个焦点节点无可见焦点环`);
  await kbBrowser.close();

  const ringSample = focusable.filter((f) => f.outlineStyle !== "none").length;
  if (!kbWhy.length) {
    pass(
      "E2-1",
      "E",
      "键盘走查（Tab 顺序、焦点可见、skip link）",
      "拦截",
      `真键盘实测：2 个受检页各 14 次 Tab，${focusable.length} 个焦点节点全部有可见焦点环（品牌色 outline），Shift+Tab 可反向，skip link 首次 Tab 命中且回车跳 #_top`,
      `焦点序列样本：${focusable
        .slice(0, 5)
        .map((f) => `${f.tag}「${f.text}」`)
        .join(" → ")}…；有焦点环节点 ${ringSample}/${focusable.length}`,
    );
  } else {
    fail(
      "E2-1",
      "E",
      "键盘走查（Tab 顺序、焦点可见、skip link）",
      "拦截",
      kbWhy.join("；"),
      "",
    );
  }
} else {
  const why = !puppeteerPath
    ? `未找到 puppeteer-core（${LF_AUDIT_HOME}）`
    : !chromePath
      ? "未找到 Chrome/Edge"
      : !live
        ? `preview 不可达（${PREVIEW}）`
        : "puppeteer 启动失败";
  manual(
    "E2-1",
    "E",
    "键盘走查（Tab 顺序、焦点可见、skip link）",
    "拦截",
    `未做浏览器端键盘实测：${why}。此项标「未验证」，须人工走查。`,
  );
}

// ---------------------------------------------------------------- 输出
const order = { 拦截: 0, 必修: 1, 建议: 2 };
results.sort(
  (a, b) => order[a.severity] - order[b.severity] || a.id.localeCompare(b.id),
);
const blockers = results.filter(
  (r) => r.severity === "拦截" && r.status === "FAIL",
);

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        script: "audit-frontmatter",
        baseline: DIST,
        pageCount: rows.length,
        zh: rows.filter((r) => !r.en).length,
        en: rows.filter((r) => r.en).length,
        results,
        blockers: blockers.length,
      },
      null,
      2,
    ),
  );
} else {
  const icon = { PASS: "✓", FAIL: "✗", MANUAL: "?" };
  console.log("\n=== audit-frontmatter · 逐页 head 与文档结构（A / E / H）===");
  console.log(`产物：${DIST}`);
  console.log(
    `页数：${rows.length}（zh ${rows.filter((r) => !r.en).length} / en ${rows.filter((r) => r.en).length}）\n`,
  );
  for (const r of results) {
    console.log(`${icon[r.status]} [${r.severity}] ${r.id} ${r.name}`);
    console.log(`    ${r.detail}`);
    if (r.evidence) console.log(`    证据：${r.evidence}`);
  }
  const cnt = (s, st) =>
    results.filter((r) => r.severity === s && r.status === st).length;
  console.log("\n--- 汇总 ---");
  for (const s of ["拦截", "必修", "建议"])
    console.log(
      `${s}：通过 ${cnt(s, "PASS")} / 失败 ${cnt(s, "FAIL")} / 待人工 ${cnt(s, "MANUAL")}`,
    );
  console.log(`\n拦截级失败：${blockers.length}`);
}
process.exit(blockers.length === 0 ? 0 : 1);
