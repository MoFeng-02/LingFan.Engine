#!/usr/bin/env node
/**
 * audit-ia.mjs · 信息架构与响应式检查（界面规范 · A 组 / F 组）
 * ---------------------------------------------------------------------------
 * 覆盖界面规范 契约：
 *   A 组 · 信息架构
 *     - 侧栏与冻结 IA（对应章节）1:1：分组数 / 分组顺序 / 分组标签 / P0 页归属
 *     - 内部断链 0（含 #锚点级）
 *     - 侧栏不平铺：单分组直接子项 ≤12；参考区深度 ≥2
 *     - 对应章节 URL 规则：zh 无前缀 / en 走 /en/、全英文 kebab-case slug、trailingSlash always
 *     - 对应章节 op 参考：9 个域页齐备、65 个内建 op 锚点全覆盖且不重复、总览只链实际存在的域页
 *   F 组 · 响应式
 *     - 320 / 375 / 768 / 1024 / 1440 五档无页面级横向滚动
 *     - 移动菜单焦点管理（打开时主内容 inert、Escape 关闭并恢复）
 *
 * 度量基线：production 产物 docs/dist（`astro build` 输出）。dev server 的 HTML
 * 与 dist 不同，不得作为判据。
 *
 * 浏览器项（F 组）需要 puppeteer-core + 本机 Chrome：探测不到时降级为 MANUAL
 * 并在报告中显式标「未验证」，绝不静默判过。
 *
 * 用法：
 *   cd docs && node scripts/audit-ia.mjs           # 人类可读
 *   cd docs && node scripts/audit-ia.mjs --json    # 机器可读（报告用）
 * 退出码：0 = 无「拦截级」失败；1 = 存在拦截级失败或 dist 缺失。
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { createRequire } from "node:module";

const DIST = resolve(process.cwd(), "dist");
const DOCS = process.cwd();
const REPO = resolve(DOCS, "..");
const JSON_OUT = process.argv.includes("--json");
const BASE = "/LingFan.Engine";
const PREVIEW =
  process.env.LF_PREVIEW ?? "http://127.0.0.1:4322/LingFan.Engine";
const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const PUPPETEER_CANDIDATES = [
  process.env.LF_AUDIT_HOME && join(process.env.LF_AUDIT_HOME, "package.json"),
  "E:/Temp/Windows/lf-audit/package.json",
].filter(Boolean);

// ---------------------------------------------------------------- 判定框架
const results = [];
const check = (id, group, name, severity, status, detail, evidence = "") =>
  results.push({ id, group, name, severity, status, detail, evidence });
const pass = (id, g, n, s, d, e) => check(id, g, n, s, "PASS", d, e);
const fail = (id, g, n, s, d, e) => check(id, g, n, s, "FAIL", d, e);
const manual = (id, g, n, s, d) => check(id, g, n, s, "MANUAL", d, "");

if (!existsSync(DIST)) {
  console.error(`[audit-ia] 找不到 production 产物：${DIST}`);
  console.error("  请先执行：cd docs && npx astro build");
  process.exit(1);
}

// ---------------------------------------------------------------- 冻结 IA（界面规范）
const IA = [
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
const OP_DOMAINS = [
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
const GROUP_LINK_LIMIT = 12;
const REFERENCE_MIN_DEPTH = 2;

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
const pages = htmlFiles.map((p) => {
  const html = readFileSync(p, "utf8");
  return { path: p, url: urlOf(p), html, en: urlOf(p).startsWith("/en/") };
});
const zhPages = pages.filter((p) => !p.en);
const byUrl = new Map(pages.map((p) => [p.url, p]));
const idsOf = (html) =>
  new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]));

// ---------------------------------------------------------------- A1 侧栏与冻结 IA 1:1
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

const sidebarPage =
  byUrl.get("/introduction/") ?? zhPages.find((p) => !p.url.startsWith("/404"));
const sidebar = sidebarPage ? parseSidebar(sidebarPage.html) : null;
const groups = sidebar ? sidebar.children : [];

if (!groups.length) {
  fail(
    "A1-1",
    "A",
    "侧栏分组与冻结 IA（对应章节）一致",
    "拦截",
    "无法从内容页解析侧栏分组",
    `取样页：${sidebarPage?.url ?? "无"}`,
  );
} else {
  const labels = groups.map((g) => g.label);
  const expected = IA.map((g) => g.label);
  const sameOrder =
    labels.length === expected.length &&
    labels.every((l, i) => l === expected[i]);
  if (sameOrder) {
    pass(
      "A1-1",
      "A",
      "侧栏分组数 / 顺序 / 标签与冻结 IA（对应章节）一致",
      "拦截",
      `${labels.length} 个分组：${labels.join(" / ")}`,
      `取样页 ${sidebarPage.url}`,
    );
  } else {
    fail(
      "A1-1",
      "A",
      "侧栏分组数 / 顺序 / 标签与冻结 IA（对应章节）一致",
      "拦截",
      `实际 ${labels.length} 个：${labels.join(" / ")}；期望 ${expected.length} 个：${expected.join(" / ")}`,
      "",
    );
  }

  // P0 页归属：对应章节 列出的 P0 标签必须出现在其所属分组内
  const missing = [];
  for (const g of IA) {
    if (!g.p0.length) continue;
    const actual = groups.find((x) => x.label === g.label);
    for (const item of g.p0) {
      if (!actual || !actual.links.some((l) => l.label === item))
        missing.push(`${g.label} → ${item}`);
    }
  }
  if (!missing.length) {
    pass(
      "A1-2",
      "A",
      "冻结 IA 的 P0 页全部在所属分组内",
      "拦截",
      `${IA.reduce((n, g) => n + g.p0.length, 0)} 个 P0 条目全部命中`,
      "P1 页（从模板创建工程 / 视觉元素 / 小游戏 / 扩展引擎）为已实现的额外条目",
    );
  } else {
    fail(
      "A1-2",
      "A",
      "冻结 IA 的 P0 页全部在所属分组内",
      "拦截",
      `${missing.length} 项缺失`,
      missing.join(", "),
    );
  }
}

// 侧栏无死链 + 全站可达
const allSidebarLinks = [];
const collect = (node) => {
  for (const l of node.links) allSidebarLinks.push(l);
  for (const c of node.children) collect(c);
};
if (sidebar) collect(sidebar);
/** 把站点绝对链接解析为 dist 中的实体文件 */
function resolveLink(href) {
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

const dead = allSidebarLinks.filter(
  (l) => l.href.startsWith("/") && !resolveLink(l.href).file,
);
const externalLinks = allSidebarLinks.filter((l) => !l.href.startsWith("/"));
if (!dead.length) {
  pass(
    "A1-3",
    "A",
    "侧栏链接无死链",
    "拦截",
    `${allSidebarLinks.length - externalLinks.length} 条站内侧栏链接全部命中 dist 实体`,
    externalLinks.length
      ? `另有 ${externalLinks.length} 条外部链接（${externalLinks.map((l) => l.label).join(", ")}）按外链处理，不做 dist 解析`
      : "",
  );
} else {
  fail(
    "A1-3",
    "A",
    "侧栏链接无死链",
    "拦截",
    `${dead.length} 条死链`,
    dead.map((l) => `${l.label} → ${l.href}`).join(", "),
  );
}

const reachable = new Set(allSidebarLinks.map((l) => resolveLink(l.href).path));
// 独立路由页豁免：/demo/（内嵌引擎演示页）按产品判定不进侧栏，与首页、404 一样不算「不可达内容页」。
const standalonePages = ["/demo/"];
const unreachable = zhPages.filter(
  (p) =>
    !p.url.startsWith("/404") &&
    p.url !== "/" &&
    !standalonePages.includes(p.url) &&
    !reachable.has(p.url),
);
if (!unreachable.length) {
  pass(
    "A1-4",
    "A",
    "zh 内容页 100% 可从侧栏到达",
    "拦截",
    `${zhPages.length - 2 - standalonePages.length} 个内容页（除首页、404 与独立路由页）全部在侧栏中`,
    "",
  );
} else {
  fail(
    "A1-4",
    "A",
    "zh 内容页 100% 可从侧栏到达",
    "拦截",
    `${unreachable.length} 页不可达`,
    unreachable.map((p) => p.url).join(", "),
  );
}

// ---------------------------------------------------------------- A2 侧栏不平铺
if (groups.length) {
  const ownCounts = groups.map((g) => ({
    label: g.label,
    n: g.links.length,
    sub: g.children.length,
  }));
  const worst = ownCounts.reduce((a, b) => (b.n > a.n ? b : a));
  if (worst.n <= GROUP_LINK_LIMIT) {
    pass(
      "A2-1",
      "A",
      `侧栏不平铺：单分组直接子项 ≤ ${GROUP_LINK_LIMIT}`,
      "拦截",
      `各分组直接子项：${ownCounts.map((c) => `${c.label}=${c.n}${c.sub ? `(+${c.sub} 子分组)` : ""}`).join(" / ")}；最大 ${worst.n}`,
      "「参考」组把 10 个 op 域页收进二级子分组，是唯一超过 3 项的分组",
    );
  } else {
    fail(
      "A2-1",
      "A",
      `侧栏不平铺：单分组直接子项 ≤ ${GROUP_LINK_LIMIT}`,
      "拦截",
      `${worst.label} 有 ${worst.n} 个直接子项`,
      "",
    );
  }

  // 参考区深度：参考 → op 指令参考 → 链接 = 2 层分组
  const depthOf = (node, level = 1) => {
    let best = node.links.length ? level : 0;
    for (const c of node.children) best = Math.max(best, depthOf(c, level + 1));
    return best;
  };
  const refDepth = depthOf(
    groups.find((g) => g.label === "参考") ?? { links: [], children: [] },
  );
  if (refDepth >= REFERENCE_MIN_DEPTH) {
    pass(
      "A2-2",
      "A",
      `参考区分级深度 ≥ ${REFERENCE_MIN_DEPTH}`,
      "拦截",
      `参考 → op 指令参考 → 链接 = 深度 ${refDepth}`,
      "",
    );
  } else {
    fail(
      "A2-2",
      "A",
      `参考区分级深度 ≥ ${REFERENCE_MIN_DEPTH}`,
      "拦截",
      `实测深度 ${refDepth}`,
      "",
    );
  }

  const collapsed = groups.filter(
    (g) => g.label !== "开始上手" && g.label !== "核心概念" && !g.open,
  );
  const expandedShouldCollapse = groups.filter(
    (g) => ["指南", "参考", "进阶"].includes(g.label) && g.open,
  );
  if (!expandedShouldCollapse.length) {
    pass(
      "A2-3",
      "A",
      "P0 组默认展开、其余组默认折叠",
      "必修",
      `默认折叠：${collapsed.map((g) => g.label).join(" / ") || "无"}`,
      "与界面规范「域组 collapsed: true」一致",
    );
  } else {
    fail(
      "A2-3",
      "A",
      "P0 组默认展开、其余组默认折叠",
      "必修",
      `${expandedShouldCollapse.map((g) => g.label).join(" / ")} 未折叠`,
      "",
    );
  }
}

// ---------------------------------------------------------------- A4 对应章节 / 对应章节
const opsFromEngine = (() => {
  const f = join(REPO, "packages/engine/src/runtime/opRegistry.ts");
  if (!existsSync(f)) return null;
  const body = readFileSync(f, "utf8").match(
    /BUILTIN_OP_NAMES[\s\S]*?new Set\(\[([\s\S]*?)\]\)/,
  );
  if (!body) return null;
  return [...body[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
})();
const OP_NAMES = opsFromEngine ?? [];

const domainPages = OP_DOMAINS.map((d) => ({
  d,
  page: byUrl.get(`/reference/ops/${d}/`),
}));
const missingDomains = domainPages.filter((x) => !x.page);
if (!missingDomains.length) {
  pass(
    "A4-1",
    "A",
    "9 个 op 域页齐备（对应章节）",
    "拦截",
    OP_DOMAINS.map((d) => `/reference/ops/${d}/`).join(", "),
    "",
  );
} else {
  fail(
    "A4-1",
    "A",
    "9 个 op 域页齐备（对应章节）",
    "拦截",
    `缺 ${missingDomains.length} 页`,
    missingDomains.map((x) => x.d).join(", "),
  );
}

if (OP_NAMES.length) {
  const anchors = new Map();
  for (const { d, page } of domainPages) {
    if (!page) continue;
    for (const m of page.html.matchAll(/id="op-([a-z_]+)"/g)) {
      if (!anchors.has(m[1])) anchors.set(m[1], []);
      anchors.get(m[1]).push(d);
    }
  }
  const missing = OP_NAMES.filter((o) => !anchors.has(o));
  const dup = [...anchors.entries()].filter(([, ds]) => new Set(ds).size > 1);
  const extra = [...anchors.keys()].filter((o) => !OP_NAMES.includes(o));
  if (!missing.length && !dup.length && !extra.length) {
    pass(
      "A4-2",
      "A",
      "65 个内建 op 在域页中各有一个锚点小节且不重复",
      "拦截",
      `${OP_NAMES.length} 个 op 全部命中，覆盖 ${new Set([...anchors.values()].flat()).size} 个域页`,
      "op 名单取自 packages/engine/src/runtime/opRegistry.ts 的 BUILTIN_OP_NAMES（单一事实源）",
    );
  } else {
    fail(
      "A4-2",
      "A",
      "65 个内建 op 在域页中各有一个锚点小节且不重复",
      "拦截",
      `缺失 ${missing.length} / 跨域重复 ${dup.length} / 名单外 ${extra.length}`,
      `缺失：${missing.join(", ") || "无"}；重复：${dup.map(([o, ds]) => `${o}(${ds.join("+")})`).join(", ") || "无"}；名单外：${extra.join(", ") || "无"}`,
    );
  }

  // 总览页：65 个 op 锚点链接齐全，且只链实际存在的域页
  const overview = byUrl.get("/reference/ops/");
  if (!overview) {
    fail(
      "A4-3",
      "A",
      "op 总览页链接覆盖 65 op 且只链实际存在的域页",
      "拦截",
      "缺 /reference/ops/",
      "",
    );
  } else {
    const hrefs = [...overview.html.matchAll(/href="([^"]*)"/g)].map(
      (m) => m[1],
    );
    const local = hrefs
      .map((h) => (h.startsWith(BASE) ? h.slice(BASE.length) : h))
      .filter((h) => h.startsWith("/"));
    const linkedOps = new Set(
      local
        .filter((h) => h.startsWith("/reference/ops/") && h.includes("#op-"))
        .map((h) => h.split("#op-")[1]),
    );
    const missingOps = OP_NAMES.filter((o) => !linkedOps.has(o));
    const linkedDomains = new Set(
      local.filter((h) => /^\/reference\/ops\/[a-z]+\/$/.test(h)),
    );
    const danglingDomains = [...linkedDomains].filter(
      (h) => !existsSync(join(DIST, h.replace(/^\//, ""), "index.html")),
    );
    if (!missingOps.length && !danglingDomains.length) {
      pass(
        "A4-3",
        "A",
        "op 总览页链接覆盖 65 op 且只链实际存在的域页",
        "拦截",
        `总览页链出 ${linkedOps.size} 个 op 锚点、${linkedDomains.size} 个域页，全部命中实体`,
        "",
      );
    } else {
      fail(
        "A4-3",
        "A",
        "op 总览页链接覆盖 65 op 且只链实际存在的域页",
        "拦截",
        `未链 op ${missingOps.length} 个；悬空域页 ${danglingDomains.length} 个`,
        `未链：${missingOps.join(", ") || "无"}；悬空：${danglingDomains.join(", ") || "无"}`,
      );
    }
  }
} else {
  manual(
    "A4-2",
    "A",
    "65 个内建 op 锚点覆盖",
    "拦截",
    `未能从 ${join(REPO, "packages/engine/src/runtime/opRegistry.ts")} 读取 BUILTIN_OP_NAMES，本轮未验证`,
  );
}

// slug 规则 + trailingSlash：全站链接不带 .html
const htmlLinks = pages.flatMap((p) =>
  [...p.html.matchAll(/(?:href|src)="([^"]*)"/g)].map((m) => ({
    url: p.url,
    href: m[1],
  })),
);
const dotHtml = htmlLinks.filter(
  (l) => l.href.startsWith(BASE) && /\.html?(?:#|$)/.test(l.href),
);
const badSlug = [...new Set(pages.map((p) => p.url))].filter((u) =>
  /[A-Z_]/.test(u),
);
if (!dotHtml.length && !badSlug.length) {
  pass(
    "A4-4",
    "A",
    "URL 规则：目录式（trailingSlash always）+ 全英文 kebab-case slug",
    "必修",
    `${pages.length} 页 URL 无 .html 后缀、无大写或下划线`,
    "",
  );
} else {
  fail(
    "A4-4",
    "A",
    "URL 规则：目录式（trailingSlash always）+ 全英文 kebab-case slug",
    "必修",
    `.html 链接 ${dotHtml.length} 处；非 kebab 路径 ${badSlug.length} 个`,
    `${dotHtml
      .slice(0, 5)
      .map((l) => `${l.url} → ${l.href}`)
      .join(", ")} ${badSlug.slice(0, 5).join(", ")}`,
  );
}

// ---------------------------------------------------------------- A5 内部断链（全站）
const broken = [];
const fragBroken = [];
for (const l of htmlLinks) {
  if (!l.href.startsWith(BASE)) continue;
  const r = resolveLink(l.href);
  if (!r.file) {
    broken.push(`${l.url} → ${l.href}`);
    continue;
  }
  if (r.frag && r.file.endsWith(".html")) {
    const target = readFileSync(r.file, "utf8");
    const frag = decodeURIComponent(r.frag);
    if (!idsOf(target).has(frag)) fragBroken.push(`${l.url} → ${l.href}`);
  }
}
const nonBase = htmlLinks.filter(
  (l) => l.href.startsWith("/") && !l.href.startsWith(BASE),
);
if (!broken.length && !fragBroken.length && !nonBase.length) {
  pass(
    "A5-1",
    "A",
    "内部断链 0（含 #锚点级与 base 前缀一致性）",
    "拦截",
    `扫描 ${pages.length} 页 ${htmlLinks.length} 条 href/src：文件级 0 断链、锚点级 0 断链、未加 base 前缀 0 处`,
    `验证基线：全站扫描 (?:href|src)="(/[^"]*)" 排除 ${BASE}* ⇒ 0 命中`,
  );
} else {
  fail(
    "A5-1",
    "A",
    "内部断链 0（含 #锚点级与 base 前缀一致性）",
    "拦截",
    `文件级 ${broken.length} / 锚点级 ${fragBroken.length} / 缺 base 前缀 ${nonBase.length}`,
    `${broken.slice(0, 8).join("; ")} ${fragBroken.slice(0, 8).join("; ")} ${nonBase
      .slice(0, 8)
      .map((l) => `${l.url} → ${l.href}`)
      .join("; ")}`,
  );
}

// ---------------------------------------------------------------- F 组 · 浏览器实测
const isAlive = async (url) => {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
};
const puppeteerPath = PUPPETEER_CANDIDATES.find((p) => existsSync(p));
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
const live = await isAlive(PREVIEW + "/");

if (!puppeteerPath || !chromePath || !live) {
  const why = !puppeteerPath
    ? `未找到 puppeteer-core（探测：${PUPPETEER_CANDIDATES.join(" | ")}）`
    : !chromePath
      ? "未找到本机 Chrome / Edge"
      : `preview 未在 ${PREVIEW} 响应（先执行 cd docs && npx astro preview --port 4322）`;
  manual(
    "F1-1",
    "F",
    "320/375/768/1024/1440 五档无页面级横向滚动",
    "拦截",
    `${why}；本轮未验证`,
  );
  manual(
    "F2-1",
    "F",
    "移动菜单焦点管理（打开时主内容 inert、Escape 关闭恢复）",
    "必修",
    `${why}；本轮未验证`,
  );
} else {
  const req = createRequire(puppeteerPath);
  const puppeteer = req("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "shell",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  const SAMPLE = [
    ["首页", "/"],
    ["指南页", "/guides/dialogue/"],
    ["最重 op 域页", "/reference/ops/stage/"],
    ["其 en 对应页", "/en/reference/ops/"],
  ];
  const WIDTHS = [320, 375, 768, 1024, 1440];
  const scrollFail = [];
  const measurements = [];
  try {
    for (const [name, p] of SAMPLE) {
      await page.goto(PREVIEW + p, { waitUntil: "networkidle2" });
      for (const w of WIDTHS) {
        await page.setViewport({ width: w, height: 900 });
        await new Promise((r) => setTimeout(r, 200));
        const m = await page.evaluate(() => ({
          doc: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        measurements.push(`${p}@${w}=${m.doc}`);
        if (m.doc > m.client + 1 || m.body > m.client + 1)
          scrollFail.push(
            `${name}${p} @${w}px（scrollWidth ${m.doc} > clientWidth ${m.client}）`,
          );
      }
    }
    if (!scrollFail.length) {
      pass(
        "F1-1",
        "F",
        "320/375/768/1024/1440 五档无页面级横向滚动",
        "拦截",
        `受检集合 ${SAMPLE.length} 页 × 5 档 = ${measurements.length} 次实测，documentElement.scrollWidth 恒等于 clientWidth`,
        `受检：${SAMPLE.map((s) => s[1]).join(", ")}；宽度 ${WIDTHS.join("/")}`,
      );
    } else {
      fail(
        "F1-1",
        "F",
        "320/375/768/1024/1440 五档无页面级横向滚动",
        "拦截",
        `${scrollFail.length} 处横向溢出`,
        scrollFail.join("; "),
      );
    }

    // 移动菜单焦点管理
    await page.setViewport({ width: 375, height: 812 });
    await page.goto(PREVIEW + "/guides/dialogue/", {
      waitUntil: "networkidle2",
    });
    const before = await page.evaluate(() => ({
      display: getComputedStyle(document.querySelector("sl-sidebar-pane"))
        .display,
      mainInert: document.querySelector(".main-frame").hasAttribute("inert"),
    }));
    await page.click(".sl-menu-button");
    await new Promise((r) => setTimeout(r, 300));
    const opened = await page.evaluate(() => ({
      display: getComputedStyle(document.querySelector("sl-sidebar-pane"))
        .display,
      mainInert: document.querySelector(".main-frame").hasAttribute("inert"),
      skipInert: document.querySelector(".sl-skip-link").hasAttribute("inert"),
    }));
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 300));
    const closed = await page.evaluate(() => ({
      display: getComputedStyle(document.querySelector("sl-sidebar-pane"))
        .display,
      mainInert: document.querySelector(".main-frame").hasAttribute("inert"),
    }));
    const ok =
      before.display === "none" &&
      !before.mainInert &&
      opened.display !== "none" &&
      opened.mainInert &&
      opened.skipInert &&
      closed.display === "none" &&
      !closed.mainInert;
    const detail = `打开前 display=${before.display}/main inert=${before.mainInert}；打开后 display=${opened.display}/main inert=${opened.mainInert}/skip-link inert=${opened.skipInert}；Escape 后 display=${closed.display}/main inert=${closed.mainInert}`;
    if (ok)
      pass(
        "F2-1",
        "F",
        "移动菜单焦点管理（打开时主内容 inert、Escape 关闭恢复）",
        "必修",
        detail,
        "Starlight sl-sidebar-pane 的 trapFocus() 对 .main-frame 与 .sl-skip-link 切换 inert 属性",
      );
    else
      fail(
        "F2-1",
        "F",
        "移动菜单焦点管理（打开时主内容 inert、Escape 关闭恢复）",
        "必修",
        detail,
        "",
      );
  } finally {
    await browser.close();
  }
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
        script: "audit-ia",
        baseline: DIST,
        preview: PREVIEW,
        pageCount: pages.length,
        sidebar: groups.map((g) => ({
          label: g.label,
          open: g.open,
          ownLinks: g.links.length,
          subGroups: g.children.map((c) => ({
            label: c.label,
            links: c.links.length,
          })),
        })),
        results,
        blockers: blockers.length,
      },
      null,
      2,
    ),
  );
} else {
  const icon = { PASS: "✓", FAIL: "✗", MANUAL: "?" };
  console.log("\n=== audit-ia · 信息架构与响应式（A / F）===");
  console.log(`产物：${DIST}`);
  console.log(
    `页数：${pages.length}（zh ${zhPages.length} / en ${pages.length - zhPages.length}）`,
  );
  console.log(`预览：${PREVIEW}${live ? "" : "（未响应）"}\n`);
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
