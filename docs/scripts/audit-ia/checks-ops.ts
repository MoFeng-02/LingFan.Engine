/**
 * audit-ia · A4 op 参考页与 URL 规则
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BASE,
  DIST,
  OP_DOMAINS,
  REPO,
  byUrl,
  fail,
  htmlLinks,
  manual,
  pass,
  pages,
} from "./shared.ts";

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
    "9 个 op 域页齐备",
    "拦截",
    OP_DOMAINS.map((d) => `/reference/ops/${d}/`).join(", "),
    "",
  );
} else {
  fail(
    "A4-1",
    "A",
    "9 个 op 域页齐备",
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
    `未能从 ${join(REPO, "packages/engine/src/runtime/opRegistry.ts")} 读取 BUILTIN_OP_NAMES，未验证`,
  );
}

// slug 规则 + trailingSlash：全站链接不带 .html
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
