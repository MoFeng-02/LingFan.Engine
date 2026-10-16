/**
 * 共享配置、判定框架、产物扫描与 CSS 解析工具
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const DIST = resolve(process.cwd(), "dist");
export const DOCS = process.cwd();
export const REPO = resolve(DOCS, "..");
export const SITE_NAME = "灵泛引擎";
export const SITE_NAME_EN = "LingFan Engine";
export const PREVIEW =
  process.env.LF_PREVIEW ?? "http://127.0.0.1:4322/LingFan.Engine";
export const BASELINE_DIST =
  process.env.LF_BASELINE_DIST ?? "E:/Temp/Windows/lf-baseline/dist";
export const LF_AUDIT_HOME =
  process.env.LF_AUDIT_HOME ?? "E:/Temp/Windows/lf-audit";
export const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

// ---------------------------------------------------------------- 判定框架
export const results = [];
export const check = (
  id,
  group,
  name,
  severity,
  status,
  detail,
  evidence = "",
) => results.push({ id, group, name, severity, status, detail, evidence });
export const pass = (id, g, n, s, d, e) => check(id, g, n, s, "PASS", d, e);
export const fail = (id, g, n, s, d, e) => check(id, g, n, s, "FAIL", d, e);
export const manual = (id, g, n, s, d) => check(id, g, n, s, "MANUAL", d, "");

if (!existsSync(DIST)) {
  console.error(`[audit-redline] 找不到 production 产物：${DIST}`);
  console.error("  请先执行：cd docs && npx astro build");
  process.exit(1);
}

// ---------------------------------------------------------------- 工具
export const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
export const urlOf = (p) =>
  "/" +
  relative(DIST, p)
    .split("\\")
    .join("/")
    .replace(/index\.html$/, "")
    .replace(/^404\.html$/, "404/");
export const rel = (p) => relative(DIST, p).split("\\").join("/");
export const read = (p) => readFileSync(p, "utf8");
/** 二进制探测：前 8KB 出现 NUL 即视为二进制（Pagefind 索引即此形态） */
export const isBinary = (p) => {
  const b = readFileSync(p);
  return b.subarray(0, 8192).includes(0);
};
/** 去掉 HTML 的 script/style/svg 内容与全部标签，只留人类可见文本 */
export const visibleText = (html) =>
  html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");

export const allFiles = walk(DIST).sort();
export const htmlFiles = allFiles.filter((f) => f.endsWith(".html"));
export const cssFiles = allFiles.filter((f) => f.endsWith(".css"));
export const jsonFiles = allFiles.filter((f) => f.endsWith(".json"));
export const pages = htmlFiles.map((p) => {
  const html = read(p);
  return {
    path: p,
    url: urlOf(p),
    rel: rel(p),
    html,
    en: urlOf(p).startsWith("/en/"),
    text: visibleText(html),
  };
});

// ================================================================ 令牌
export const TOKENS_PATH = join(DOCS, "src", "styles", "tokens.css");
export const BASE_PATH = join(DOCS, "src", "styles", "base.css");
export const STYLE_DIR = join(DOCS, "src", "styles");
export const tokensCss = existsSync(TOKENS_PATH) ? read(TOKENS_PATH) : "";
export const baseCss = existsSync(BASE_PATH) ? read(BASE_PATH) : "";

/**
 * 把 CSS 注释替换成等长空白（保留换行与偏移）。
 * 不做这一步时 `/([^{}]*)\{/` 会把块首的大段注释一并吞进选择器，
 * 使 `:root` 判定失败（tokens.css 头部有 327 字符的注释块）。
 */
export const blankComments = (css) =>
  css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

/** 取某选择器块体内的声明表（支持一层嵌套 @media） */
export function declBlocks(cssRaw) {
  const css = blankComments(cssRaw);
  const out = [];
  const re = /([^{}]*)\{/g;
  let m;
  while ((m = re.exec(css))) {
    const sel = m[1]
      .trim()
      .replace(/^@media[^{]*/i, "")
      .trim();
    const start = re.lastIndex;
    let depth = 1;
    let i = start;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    out.push({ sel, body: css.slice(start, i - 1), index: m.index });
    re.lastIndex = start;
  }
  return out;
}
export const declsOf = (body) =>
  [...body.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;}]+)/g)].map((m) => [
    m[1],
    m[2].trim(),
  ]);

/** 收集某主题下的变量表（dark = :root 基准；light = :root + :root[data-theme='light']） */
export function themeVars(theme) {
  const vars = new Map();
  for (const b of declBlocks(tokensCss)) {
    const sel = b.sel.replace(/\s+/g, "");
    if (
      sel.includes("data-theme='light'") ||
      sel.includes('data-theme="light"')
    ) {
      if (theme === "light")
        for (const [k, v] of declsOf(b.body)) vars.set(k, v);
    } else if (/^:root$/.test(sel)) {
      for (const [k, v] of declsOf(b.body)) vars.set(k, v);
    }
  }
  return vars;
}
export const resolveVar = (vars, value, depth = 0) => {
  if (depth > 8 || typeof value !== "string") return value;
  const m = value.match(/^var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*([\s\S]+))?\)$/);
  if (!m) return value;
  const v = vars.get(m[1]);
  if (v === undefined)
    return m[2] !== undefined ? m[2].trim() : `unresolved(${m[1]})`;
  return resolveVar(vars, v, depth + 1);
};
export const hexOf = (v) => {
  const s = String(v)
    .trim()
    .replace(/^["']|["']$/g, "");
  const m = s.match(/^#([0-9a-fA-F]{3,8})$/);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  if (h.length === 4)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6) return null;
  return "#" + h.toLowerCase();
};
export const rgb = (hex) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export const lum = (hex) => {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
export const hslToHex = (h, s, l) => {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x) =>
    Math.round(255 * x)
      .toString(16)
      .padStart(2, "0");
  return "#" + to(f(0)) + to(f(8)) + to(f(4));
};

export const darkVars = themeVars("dark");
export const lightVars = themeVars("light");
export const getVar = (vars, name) => resolveVar(vars, vars.get(name) ?? "", 0);
