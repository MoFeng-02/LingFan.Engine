/**
 * audit-frontmatter · 共享配置、判定框架与产物扫描
 *
 * 本目录是 audit-frontmatter.mjs 的实现体：入口文件保持原文件名与 CLI 不变，
 * index.ts 为唯一出口。各模块按 index.ts 的 import 顺序求值。
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const DIST = resolve(process.cwd(), "dist");
export const SITE_NAME = "灵泛引擎";
export const SITE_ORIGIN = "https://mofeng-02.github.io/LingFan.Engine";
export const TITLE_MAX = 60;
export const DESC_MAX = 160;

// ---------------------------------------------------------------- 判定框架
export const results = [];
const check = (id, group, name, severity, status, detail, evidence = "") =>
  results.push({ id, group, name, severity, status, detail, evidence });
export const pass = (id, g, n, s, d, e) => check(id, g, n, s, "PASS", d, e);
export const fail = (id, g, n, s, d, e) => check(id, g, n, s, "FAIL", d, e);
export const manual = (id, g, n, s, d) => check(id, g, n, s, "MANUAL", d, "");

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
export const cpLen = (s) => [...decode(s)].length;

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
export function ancestorHidden(tags, idx) {
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
 * 取 <main> 的内容切片。标题层级审计必须以 main 为范围：
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
export const rows = pages.map((p) => {
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
