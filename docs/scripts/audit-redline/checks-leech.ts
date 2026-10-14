/**
 * G 组 · 内容合规（泄露词表扫描、内部文档名、可疑标记词、占位、站名、承诺、文风）
 */

import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { DOCS, REPO, SITE_NAME, SITE_NAME_EN, cssFiles, fail, isBinary, jsonFiles, manual, pages, pass, read, rel, walk } from "./shared.ts";

// ================================================================ G 组 · 内容合规
const LEECH_PATTERNS = [
  ["私有文档引用", /私有文档/g],
  ["内部规约文件", /\.rules\.md|\.rules\b|agent\.md|AGENTS\.md|CLAUDE\.md/gi],
  ["设计稿引用", /设计稿|验收契约|验收项/g],
  [
    "任务/缺陷编号",
    /任务号|缺陷号|规约编号|里程碑\s*M\d|\bW[1-6]\b(?=\s*任务)/g,
  ],
  [
    "源码路径注释",
    /packages\/engine\/src\/|apps\/[a-z]+\/src\/|\.agent-teams/g,
  ],
  ["内部代号", /Agent\s*Teams|agent-teams|主理人|qa-verifier|写入范围/g],
];
const PLACEHOLDER_PATTERNS = [
  ["My Docs", /My Docs/g],
  ["Example Guide", /Example Guide/g],
  ["Lorem ipsum", /Lorem ipsum/gi],
  ["Welcome to Starlight", /Welcome to Starlight/gi],
  ["Starlight starter 残留", /starlight-starter|houston\.webp/gi],
  ["未替换占位符", /\bTODO\b|\bTBD\b|\bXXX\b|\bFIXME\b|\{\{[a-z_]+\}\}/g],
];
/** 只扫人类可见文本（HTML 去标签去 svg/script），CSS 与 JSON 全量文本，二进制文件排除 */
function scanSources(pattern) {
  const hits = [];
  for (const p of pages) {
    for (const m of p.text.matchAll(pattern)) {
      hits.push({
        where: p.url,
        snippet: p.text
          .slice(Math.max(0, m.index - 40), m.index + 60)
          .replace(/\s+/g, " ")
          .trim(),
      });
    }
  }
  for (const p of [...cssFiles, ...jsonFiles]) {
    if (isBinary(p)) continue;
    const s = read(p);
    for (const m of s.matchAll(pattern)) {
      hits.push({
        where: rel(p),
        snippet: s
          .slice(Math.max(0, m.index - 40), m.index + 60)
          .replace(/\s+/g, " ")
          .trim(),
      });
    }
  }
  return hits;
}

// --- 源码与产物中不得出现内部文档名（严格 0 命中项）
{
  const STRICT = LEECH_PATTERNS.filter(
    ([n]) =>
      n === "私有文档引用" || n === "内部规约文件" || n === "源码路径注释",
  );
  const hits = [];
  for (const [name, re] of STRICT)
    for (const h of scanSources(new RegExp(re.source, re.flags)))
      hits.push({ name, ...h });
  if (!hits.length) {
    pass(
      "G1-1",
      "G",
      "内部内容零泄露：私有文档 / 内部规约文件 / 源码路径 0 命中",
      "拦截",
      `扫描 ${pages.length} 个 HTML 的可见文本 + ${cssFiles.length} 个 CSS + ${jsonFiles.length} 个 JSON（已排除 Pagefind 二进制索引与 SVG path 数据，二者会产生假阳性）`,
      STRICT.map(([n, re]) => `${n}: /${re.source}/ → 0`).join("；"),
    );
  } else {
    fail(
      "G1-1",
      "G",
      "内部内容零泄露：私有文档 / 内部规约文件 / 源码路径 0 命中",
      "拦截",
      `${hits.length} 处命中`,
      hits
        .slice(0, 10)
        .map((h) => `${h.where}「${h.snippet}」`)
        .join(" | "),
    );
  }
}

// --- 可疑标记词命中须人工复核（逐条登记）
{
  const REVIEW = LEECH_PATTERNS.filter(
    ([n]) => !["私有文档引用", "内部规约文件", "源码路径注释"].includes(n),
  );
  const hits = [];
  for (const [name, re] of REVIEW)
    for (const h of scanSources(new RegExp(re.source, re.flags)))
      hits.push({ name, ...h });
  if (!hits.length) {
    pass(
      "G1-2",
      "G",
      "中文内部词表复核（任务号 / 里程碑 / 内部代号）",
      "拦截",
      `词表 ${REVIEW.length} 类（${REVIEW.map(([n]) => n).join(" / ")}）在 dist 文本中 0 命中，无需人工复核`,
      REVIEW.map(([n, re]) => `${n}: /${re.source}/ → 0`).join("；"),
    );
  } else {
    manual(
      "G1-2",
      "G",
      "中文内部词表复核（任务号 / 里程碑 / 内部代号）",
      "拦截",
      `词表命中 ${hits.length} 处，须人工逐条复核并登记结论（正则无法判定是否真泄露）：` +
        hits
          .slice(0, 20)
          .map((h) => `${h.name}@${h.where}「${h.snippet}」`)
          .join(" | "),
    );
  }
}

// --- 模板占位清零
{
  const hits = [];
  for (const [name, re] of PLACEHOLDER_PATTERNS)
    for (const h of scanSources(new RegExp(re.source, re.flags)))
      hits.push({ name, ...h });
  if (!hits.length) {
    pass(
      "G2-1",
      "G",
      "模板占位清零（My Docs / Example Guide / Lorem / Welcome to Starlight / TODO）",
      "拦截",
      `${PLACEHOLDER_PATTERNS.length} 类占位模式在 ${pages.length} 页与全部 CSS/JSON 中 0 命中`,
      PLACEHOLDER_PATTERNS.map(([n]) => `${n} → 0`).join("；"),
    );
  } else {
    fail(
      "G2-1",
      "G",
      "模板占位清零（My Docs / Example Guide / Lorem / Welcome to Starlight / TODO）",
      "拦截",
      `${hits.length} 处命中`,
      hits
        .slice(0, 10)
        .map((h) => `${h.name}@${h.where}「${h.snippet}」`)
        .join(" | "),
    );
  }
}

// --- 站名一致
{
  const WRONG = [
    /灵泛引擎（[^）]*）/g,
    /LingFanEngine/g,
    /Lingfan Engine/g,
    /灵泛引擎站/g,
    /LF Engine/g,
  ];
  const wrongHits = [];
  for (const re of WRONG) for (const h of scanSources(re)) wrongHits.push(h);
  const zhPages = pages.filter((p) => !p.en);
  const enPages = pages.filter((p) => p.en);
  const zhOk = zhPages.filter((p) => p.html.includes(SITE_NAME)).length;
  const enOk = enPages.filter(
    (p) => p.html.includes(SITE_NAME_EN) || p.html.includes(SITE_NAME),
  ).length;
  const titleOk = pages.filter((p) => {
    const t = (p.html.match(/<title>([\s\S]*?)<\/title>/) || [, ""])[1];
    return t.includes(SITE_NAME);
  }).length;
  if (
    !wrongHits.length &&
    zhOk === zhPages.length &&
    enOk === enPages.length &&
    titleOk === pages.length
  ) {
    pass(
      "G3-1",
      "G",
      "站名一致「灵泛引擎 / LingFan Engine」",
      "拦截",
      `${pages.length} 页 <title> 全部含「${SITE_NAME}」；zh ${zhOk}/${zhPages.length}、en ${enOk}/${enPages.length} 页正文含站名；未发现变体写法（LingFanEngine / Lingfan Engine / LF Engine / 灵泛引擎（…））`,
      `astro.config title = 「灵泛引擎 LingFan Engine」`,
    );
  } else {
    fail(
      "G3-1",
      "G",
      "站名一致「灵泛引擎 / LingFan Engine」",
      "拦截",
      `变体命中 ${wrongHits.length} 处；title 含站名 ${titleOk}/${pages.length}`,
      wrongHits
        .slice(0, 8)
        .map((h) => `${h.where}「${h.snippet}」`)
        .join(" | "),
    );
  }
}

// --- 无未实现承诺（对照引擎公开导出面）
{
  const idxPath = join(REPO, "packages", "engine", "src", "index.ts");
  if (!existsSync(idxPath)) {
    manual(
      "G4-1",
      "G",
      "无未实现承诺（对照引擎公开导出面）",
      "拦截",
      `未运行：找不到引擎导出面 ${idxPath}。报告中标「未验证」。`,
    );
  } else {
    const idx = read(idxPath);
    const exported = new Set();
    for (const m of idx.matchAll(/^\s*([A-Za-z_$][\w$]*),?\s*$/gm))
      exported.add(m[1]);
    for (const m of idx.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g))
      for (const n of m[1].split(",")) {
        const id = n
          .trim()
          .split(/\s+as\s+/)
          .pop()
          .trim();
        if (id) exported.add(id);
      }
    for (const m of idx.matchAll(
      /export\s+(?:async\s+)?(?:function|const|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
    ))
      exported.add(m[1]);
    for (const m of idx.matchAll(/export\s+\*\s+from\s+["']([^"']+)["']/g))
      exported.add(`* from ${m[1]}`);

    // 收集文档代码块里从 @lingfan/engine 的具名导入，逐个对照导出面。
    // 直接扫源文档树（dist 只保留渲染结果，且 404 无对应源文件）。
    const imports = new Map();
    const contentRoot = join(DOCS, "src", "content", "docs");
    for (const f of walk(contentRoot).filter((f) => /\.(md|mdx)$/.test(f))) {
      const src = read(f);
      for (const m of src.matchAll(
        /import\s*\{([^}]*)\}\s*from\s*["']@lingfan\/engine["']/g,
      )) {
        for (const n of m[1].split(",")) {
          const id = n
            .trim()
            .split(/\s+as\s+/)[0]
            .trim();
          if (id)
            imports.set(
              id,
              "/" + relative(contentRoot, f).split("\\").join("/"),
            );
        }
      }
    }
    const unknown = [...imports.entries()].filter(([id]) => !exported.has(id));
    // 引擎真实依赖：docs/package.json 未声明 @lingfan/engine，站内示例不参与构建解析
    const dep = JSON.parse(read(join(DOCS, "package.json")));
    const declared = !!dep.dependencies?.["@lingfan/engine"];
    if (!unknown.length) {
      pass(
        "G4-1",
        "G",
        "无未实现承诺（对照引擎公开导出面）",
        "拦截",
        `文档中 @lingfan/engine 的具名导入共 ${imports.size} 个（${[...imports.keys()].join(", ")}），全部存在于引擎公共出口面；未发现引用未导出 API 的示例` +
          (declared
            ? ""
            : "。注：@lingfan/engine 未列入 docs/package.json 依赖，示例代码不参与站点构建解析，属文档示例而非运行时依赖"),
        `引擎导出符号 ${exported.size} 个；核对文件 packages/engine/src/index.ts`,
      );
    } else {
      fail(
        "G4-1",
        "G",
        "无未实现承诺（对照引擎公开导出面）",
        "拦截",
        `${unknown.length} 个符号不在引擎导出面：${unknown.map(([id, u]) => `${id}(${u})`).join(", ")}`,
        "",
      );
    }
  }
}

// --- 文风人工精读（禁止正则自动判过）
manual(
  "G5-1",
  "G",
  "G5 文风人工精读（十条写作规范）",
  "拦截",
  "人工精读项，禁止用正则自动判过。抽样：首页 /guides/dialogue/ + 2 个指南页 /guides/i18n/、/guides/menu-input/ + 1 个 op 域页 /reference/ops/stage/ + 1 个概念页 /concepts/story/，" +
    "按十条写作规范逐条给出「命中 / 未命中 + 原文片段」，并另判正面要求（用「你」不用「我们」、有具体命令/路径/字段名/报错原文、承认限制）。命中 ≥3 条整体判不通过。" +
    "结论由人工精读评定，本脚本不参与自动判过。",
);

// ================================================================ E 组 · axe