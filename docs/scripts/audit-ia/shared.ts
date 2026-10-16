/**
 * audit-ia · 共享配置、判定框架与产物扫描
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const DIST = resolve(process.cwd(), "dist");
export const DOCS = process.cwd();
export const REPO = resolve(DOCS, "..");
export const BASE = "/LingFan.Engine";
export const PREVIEW =
  process.env.LF_PREVIEW ?? "http://127.0.0.1:4322/LingFan.Engine";
export const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
export const PUPPETEER_CANDIDATES = [
  process.env.LF_AUDIT_HOME && join(process.env.LF_AUDIT_HOME, "package.json"),
  "E:/Temp/Windows/lf-audit/package.json",
].filter(Boolean);

// ---------------------------------------------------------------- 判定框架
export const results = [];
const check = (id, group, name, severity, status, detail, evidence = "") =>
  results.push({ id, group, name, severity, status, detail, evidence });
export const pass = (id, g, n, s, d, e) => check(id, g, n, s, "PASS", d, e);
export const fail = (id, g, n, s, d, e) => check(id, g, n, s, "FAIL", d, e);
export const manual = (id, g, n, s, d) => check(id, g, n, s, "MANUAL", d, "");

if (!existsSync(DIST)) {
  console.error(`[audit-ia] 找不到 production 产物：${DIST}`);
  console.error("  请先执行：cd docs && npx astro build");
  process.exit(1);
}

// ---------------------------------------------------------------- 既定信息架构（侧栏分组基线）
export const IA = [
  {
    label: "开始上手",
    p0: ["简介", "快速开始", "工程结构"],
    p1: ["从模板创建工程"],
  },
  {
    label: "核心概念",
    p0: ["故事与叙事流", "状态与变量", "回溯与历史", "存档系统", "多语言故事"],
    p1: ["视觉元素", "小游戏", "扩展引擎"],
  },
  {
    label: "指南",
    p0: ["编写对话与立绘", "菜单输入与通知", "制作多语言工程"],
    p1: [],
  },
  { label: "参考", p0: [], p1: [] }, // 参考组：子分组 op 指令参考（10 项）+ 3 个直接页
  { label: "进阶", p0: [], p1: [] }, // 首期空分组，P1 页尚未编写
];
export const OP_DOMAINS = [
  "dialogue",
  "flow",
  "conditions",
  "data",
  "saves",
  "audio",
  "video",
  "stage",
  "interaction",
];
export const GROUP_LINK_LIMIT = 12;
export const REFERENCE_MIN_DEPTH = 2;

// ---------------------------------------------------------------- 工具
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
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
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/g, "/");

const htmlFiles = walk(DIST)
  .filter((f) => f.endsWith(".html"))
  .sort();
export const pages = htmlFiles.map((p) => {
  const html = readFileSync(p, "utf8");
  return { path: p, url: urlOf(p), html, en: urlOf(p).startsWith("/en/") };
});
export const zhPages = pages.filter((p) => !p.en);
export const byUrl = new Map(pages.map((p) => [p.url, p]));
export const idsOf = (html) =>
  new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]));

/** 从内容页解析侧栏树：分组（<details>）→ 直属链接 / 嵌套子分组 */
function parseSidebar(html) {
  const navStart = html.search(/<nav class="sidebar[^"]*"[^>]*>/);
  if (navStart < 0) return null;
  const navEnd = html.indexOf("</nav>", navStart);
  const nav = html.slice(navStart, navEnd).replace(/<svg[\s\S]*?<\/svg>/g, "");
  const root = { label: "(root)", open: true, links: [], children: [] };
  const stack = [root];
  const re = /<(\/?)(details|ul|a)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(nav))) {
    const [, close, tag, attrs] = m;
    const cur = stack[stack.length - 1];
    if (tag === "a") {
      if (close) continue;
      const href = (attrs.match(/href="([^"]*)"/) || [, ""])[1];
      const after = nav.slice(m.index + m[0].length);
      const label = decode(
        (after.match(/<span[^>]*>([\s\S]*?)<\/span>/) || [, ""])[1],
      ).trim();
      cur.links.push({
        href,
        label,
        current: /aria-current="page"/.test(attrs),
      });
    } else if (tag === "details") {
      if (close) {
        if (stack.length > 1) stack.pop();
      } else {
        const head = nav.slice(
          m.index,
          nav.indexOf("<ul", m.index) < 0
            ? m.index + 400
            : nav.indexOf("<ul", m.index),
        );
        const label = decode(
          (head.match(/class="large[^"]*"[^>]*>([\s\S]*?)<\/span>/) || [
            ,
            "",
          ])[1],
        ).trim();
        const node = {
          label,
          open: /(^|\s)open(\s|$)/.test(attrs.replace(/"[^"]*"/g, "")),
          links: [],
          children: [],
        };
        cur.children.push(node);
        stack.push(node);
      }
    }
  }
  return root;
}

export const sidebarPage =
  byUrl.get("/introduction/") ?? zhPages.find((p) => !p.url.startsWith("/404"));
export const sidebar = sidebarPage ? parseSidebar(sidebarPage.html) : null;
export const groups = sidebar ? sidebar.children : [];

/** 全站 href/src 链接清单（URL 规则与断链检查共用） */
export const htmlLinks = pages.flatMap((p) =>
  [...p.html.matchAll(/(?:href|src)="([^"]*)"/g)].map((m) => ({
    url: p.url,
    href: m[1],
  })),
);

/** 把站点绝对链接解析为 dist 中的实体文件 */
export function resolveLink(href) {
  if (!href.startsWith("/")) return { external: true };
  let p = href;
  const hash = p.indexOf("#");
  const frag = hash >= 0 ? p.slice(hash + 1) : "";
  if (hash >= 0) p = p.slice(0, hash);
  if (p.startsWith(BASE)) p = p.slice(BASE.length);
  if (p === "") p = "/";
  const rel = p.replace(/^\//, "");
  const candidates = [
    join(DIST, rel, "index.html"),
    join(DIST, rel),
    join(DIST, rel + ".html"),
    join(DIST, rel.replace(/\/$/, ""), "index.html"),
    join(DIST, rel.replace(/\/$/, "") + ".html"),
  ];
  const hit = candidates.find((c) => existsSync(c) && !readdirSafeIsDir(c));
  return { file: hit, frag, path: p };
}
function readdirSafeIsDir(p) {
  try {
    return readdirSync(p).length >= 0;
  } catch {
    return false;
  }
}
