/**
 * audit-i18n · 共享配置、结果收集与产物扫描
 *
 * 本目录是 audit-i18n.mjs 的实现体：入口文件保持原文件名与 CLI 不变，
 * index.ts 为唯一出口。各模块按 index.ts 的 import 顺序求值。
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const DIST = resolve(process.cwd(), "dist");
export const SRC = resolve(process.cwd(), "src");
const SITE_ORIGIN = "https://mofeng-02.github.io/LingFan.Engine";

// fallback 提示条文案来自 src/content/i18n/en.json 的 i18n.untranslatedContent
export const FALLBACK_TEXT =
  "This page has not been translated into your language yet.";
export const NO_NAV_PAGES = new Set(["/", "/en/", "/404/"]);

export const results = [];
const check = (id, group, name, severity, status, detail, evidence = "") =>
  results.push({ id, group, name, severity, status, detail, evidence });
export const pass = (id, g, n, s, d, e) => check(id, g, n, s, "PASS", d, e);
export const fail = (id, g, n, s, d, e) => check(id, g, n, s, "FAIL", d, e);
export const manual = (id, g, n, s, d) => check(id, g, n, s, "MANUAL", d, "");

if (!existsSync(DIST)) {
  console.error(`[audit-i18n] 找不到 production 产物：${DIST}`);
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
const plain = (html) =>
  decode(
    html
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<style[\s\S]*?<\/style>/g, "")
      .replace(/<[^>]+>/g, " "),
  );
/** dist 内 URL 是否解析得到真实文件（trailingSlash: always + directory 格式；/404/ 例外为 dist/404.html） */
const distFile = (u) => {
  const p = u.replace(/^\/LingFan\.Engine/, "") || "/";
  if (p === "/404/" || p === "/404") return existsSync(join(DIST, "404.html"));
  return existsSync(
    join(DIST, p.replace(/^\//, "").replace(/\/$/, "/index.html")),
  );
};
export const distHasUrl = (absUrl) => {
  if (!absUrl.startsWith(SITE_ORIGIN)) return null;
  return distFile(absUrl.slice(SITE_ORIGIN.length) || "/");
};

export const rows = walk(DIST).map((f) => {
  const html = readFileSync(f, "utf8");
  const url = urlOf(f);
  const lang = (html.match(/<html[^>]*\blang="([^"]*)"/) || [])[1] || "";
  const alts = [...html.matchAll(/<link\b[^>]*rel="alternate"[^>]*>/g)].map(
    (m) => ({
      hreflang: (m[0].match(/hreflang="([^"]*)"/) || [])[1] || "",
      href: (m[0].match(/href="([^"]*)"/) || [])[1] || "",
    }),
  );
  return {
    file: f,
    url,
    en: url === "/en/" || url.startsWith("/en/"),
    html,
    lang,
    alts,
    isFallback: html.includes(FALLBACK_TEXT),
    text: plain(html),
  };
});
export const zhPages = rows.filter((r) => !r.en);
export const enPages = rows.filter((r) => r.en);
