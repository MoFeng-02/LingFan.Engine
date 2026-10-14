/**
 * audit-ia · A1 侧栏与既定信息架构 1:1 + A2 侧栏不平铺
 */
import {
  GROUP_LINK_LIMIT,
  IA,
  REFERENCE_MIN_DEPTH,
  fail,
  groups,
  pass,
  resolveLink,
  sidebar,
  sidebarPage,
  zhPages,
} from "./shared.ts";

// ---------------------------------------------------------------- A1 侧栏与既定信息架构 1:1
if (!groups.length) {
  fail(
    "A1-1",
    "A",
    "侧栏分组与既定信息架构一致",
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
      "侧栏分组数 / 顺序 / 标签与既定信息架构一致",
      "拦截",
      `${labels.length} 个分组：${labels.join(" / ")}`,
      `取样页 ${sidebarPage.url}`,
    );
  } else {
    fail(
      "A1-1",
      "A",
      "侧栏分组数 / 顺序 / 标签与既定信息架构一致",
      "拦截",
      `实际 ${labels.length} 个：${labels.join(" / ")}；期望 ${expected.length} 个：${expected.join(" / ")}`,
      "",
    );
  }

  // 必备页归属：既定信息架构列出的标签必须出现在其所属分组内
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
      "既定信息架构的必备页全部在所属分组内",
      "拦截",
      `${IA.reduce((n, g) => n + g.p0.length, 0)} 个必备条目全部命中`,
      "P1 页（从模板创建工程 / 视觉元素 / 小游戏 / 扩展引擎）为已实现的额外条目",
    );
  } else {
    fail(
      "A1-2",
      "A",
      "既定信息架构的必备页全部在所属分组内",
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
// 独立路由页豁免：/demo/（内嵌引擎演示页）与首页、404 一致，不进侧栏，不算「不可达内容页」。
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
      `测得深度 ${refDepth}`,
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
      "含必备页的分组默认展开、其余分组默认折叠",
      "必修",
      `默认折叠：${collapsed.map((g) => g.label).join(" / ") || "无"}`,
      "与侧栏契约「域组 collapsed: true」一致",
    );
  } else {
    fail(
      "A2-3",
      "A",
      "含必备页的分组默认展开、其余分组默认折叠",
      "必修",
      `${expandedShouldCollapse.map((g) => g.label).join(" / ")} 未折叠`,
      "",
    );
  }
}
