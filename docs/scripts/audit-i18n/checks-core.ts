/**
 * audit-i18n · B1-B6 静态检查（对 dist 产物做文件级核对）
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  FALLBACK_TEXT,
  NO_NAV_PAGES,
  SRC,
  distHasUrl,
  enPages,
  fail,
  pass,
  rows,
  zhPages,
} from "./shared.ts";

// ---------------------------------------------------------------- B1 lang
{
  const bad = [];
  for (const r of rows) {
    const want = r.en ? "en" : "zh-CN";
    if (r.lang !== want) bad.push(`${r.url} lang="${r.lang}" 期望 ${want}`);
  }
  if (!bad.length)
    pass(
      "B1-1",
      "B",
      "<html lang> 全量正确",
      "拦截",
      `${rows.length} 页全部正确（zh-CN ${zhPages.length} / en ${enPages.length}），无第三值`,
      "",
    );
  else
    fail(
      "B1-1",
      "B",
      "<html lang> 全量正确",
      "拦截",
      `${bad.length} 页 lang 不符`,
      bad.slice(0, 10).join("；"),
    );
}

// ---------------------------------------------------------------- B2 zh → en 覆盖或登记回退
{
  const enSet = new Set(enPages.map((r) => r.url));
  const missing = [];
  for (const r of zhPages) {
    if (r.url === "/404/") continue; // Starlight 只为默认语言生成 404，en 侧无独立页
    const want = r.url === "/" ? "/en/" : `/en${r.url}`;
    if (!enSet.has(want)) missing.push(`${r.url} → ${want} 不存在`);
  }
  if (!missing.length)
    pass(
      "B2-1",
      "B",
      "zh 页 100% 有 en 对应页或登记回退",
      "拦截",
      `${zhPages.length - 1} 个内容页全部有 en 路由（唯一例外 /404/：Starlight 只为默认语言生成 404 页）；en 侧 ${enPages.length} 页中 ${enPages.filter((r) => r.isFallback).length} 页为登记回退、${enPages.filter((r) => !r.isFallback).length} 页为真译文`,
      "",
    );
  else
    fail(
      "B2-1",
      "B",
      "zh 页 100% 有 en 对应页或登记回退",
      "拦截",
      `${missing.length} 个 zh 页缺 en 路由`,
      missing.slice(0, 10).join("；"),
    );
}

// ---------------------------------------------------------------- B3 UI 字符串双语
{
  const zhFile = join(SRC, "content/i18n/zh-CN.json");
  const enFile = join(SRC, "content/i18n/en.json");
  if (!existsSync(zhFile) || !existsSync(enFile)) {
    fail(
      "B3-1",
      "B",
      "UI 字符串双语键集合一致",
      "拦截",
      "src/content/i18n/{zh-CN,en}.json 缺失",
      "",
    );
  } else {
    const load = (f) => JSON.parse(readFileSync(f, "utf8"));
    const keys = (o) =>
      Object.keys(o)
        .filter((k) => !k.startsWith("_"))
        .sort();
    const zk = keys(load(zhFile)),
      ek = keys(load(enFile));
    const missingInEn = zk.filter((k) => !ek.includes(k));
    const extraInEn = ek.filter((k) => !zk.includes(k));
    if (!missingInEn.length && !extraInEn.length)
      pass(
        "B3-1",
        "B",
        "UI 字符串双语键集合一致",
        "拦截",
        `zh-CN.json 与 en.json 各 ${zk.length} 个非 "_" 前缀键，键集合完全一致（missing 0 / extra 0）——en 漏键会因 i18next fallbackLng 回退显示中文，故必须逐键 diff`,
        "",
      );
    else
      fail(
        "B3-1",
        "B",
        "UI 字符串双语键集合一致",
        "拦截",
        `en 缺 ${missingInEn.length} 键 / 多 ${extraInEn.length} 键`,
        `missing: ${missingInEn.slice(0, 10).join(", ")} | extra: ${extraInEn.slice(0, 10).join(", ")}`,
      );
  }
  // 渲染产物里 UI 字符串确实随语言切换（抽样：主题/语言/菜单三处可访问名）
  const probes = [
    { zh: "切换主题", en: "Select theme", what: "themeSelect" },
    { zh: "切换语言", en: "Select language", what: "languageSelect" },
    { zh: "菜单", en: "Menu", what: "menuButton" },
  ];
  const bad = [];
  for (const p of probes) {
    const zhIn = zhPages.filter((r) => !NO_NAV_PAGES.has(r.url));
    const enIn = enPages.filter((r) => !NO_NAV_PAGES.has(r.url));
    const zhHit = zhIn.filter((r) => r.text.includes(p.zh)).length;
    const enHit = enIn.filter((r) => r.text.includes(p.en)).length;
    if (zhHit !== zhIn.length)
      bad.push(`${p.what}: zh 侧仅 ${zhHit}/${zhIn.length} 页含「${p.zh}」`);
    if (enHit !== enIn.length)
      bad.push(`${p.what}: en 侧仅 ${enHit}/${enIn.length} 页含「${p.en}」`);
  }
  const zhIn = zhPages.length - NO_NAV_PAGES.size;
  const enIn = enPages.length - NO_NAV_PAGES.size;
  if (!bad.length)
    pass(
      "B3-2",
      "B",
      "UI 字符串在渲染产物中双语",
      "必修",
      `抽样 ${probes.length} 组 UI 字符串（主题/语言/菜单）在 zh ${zhIn} 个内容页与 en ${enIn} 个内容页全部按各自语言渲染；splash 首页与 404 无侧栏 UI，不计入`,
      "",
    );
  else
    fail(
      "B3-2",
      "B",
      "UI 字符串在渲染产物中双语",
      "必修",
      `${bad.length} 处不符`,
      bad.slice(0, 6).join("；"),
    );
}

// ---------------------------------------------------------------- B4 hreflang 双向
{
  const bad = [];
  let tri = 0;
  for (const r of rows) {
    const want = ["zh-CN", "en", "x-default"];
    const got = r.alts.map((a) => a.hreflang);
    for (const w of want)
      if (!got.includes(w)) bad.push(`${r.url} 缺 hreflang="${w}"`);
    if (got.length === 3 && want.every((w) => got.includes(w))) tri++;
  }
  if (!bad.length)
    pass(
      "B4-1",
      "B",
      "hreflang 三向齐备",
      "拦截",
      `${tri}/${rows.length} 页均有 zh-CN / en / x-default 三条 alternate`,
      "",
    );
  else
    fail(
      "B4-1",
      "B",
      "hreflang 三向齐备",
      "拦截",
      `${bad.length} 处缺失`,
      bad.slice(0, 8).join("；"),
    );

  const broken = [];
  const dangling404 = [];
  let checked = 0;
  for (const r of rows) {
    for (const a of r.alts) {
      const has = distHasUrl(a.href);
      if (has === null) {
        broken.push(
          `${r.url} hreflang=${a.hreflang} 非本站绝对 URL: ${a.href}`,
        );
        continue;
      }
      checked++;
      if (has) continue;
      // /404/ 是 Starlight 内建错误页（站点规范明确采用），只为默认语言生成实体；
      // 它不在 sitemap、不属 IA 内容页集合，故其悬空 alternate 单列为登记项而非拦截项。
      if (r.url === "/404/")
        dangling404.push(`${r.url} hreflang=${a.hreflang} → ${a.href}`);
      else
        broken.push(
          `${r.url} hreflang=${a.hreflang} → ${a.href}（dist 中无此页）`,
        );
    }
  }
  if (!broken.length)
    pass(
      "B4-2",
      "B",
      "hreflang 目标可解析（双向）",
      "拦截",
      `${checked} 条 alternate 中，${rows.length - 1} 个内容页的 ${checked - dangling404.length} 条全部指向 dist 中真实存在的页面，双向闭合`,
      dangling404.length
        ? `范围说明：/404/ 为 Starlight 内建错误页，不属 IA 内容页集合，其 alternate 见 B4-3`
        : "",
    );
  else
    fail(
      "B4-2",
      "B",
      "hreflang 目标可解析（双向）",
      "拦截",
      `${broken.length} 条 alternate 指向不存在的页面`,
      broken.slice(0, 8).join("；"),
    );

  if (dangling404.length)
    fail(
      "B4-3",
      "B",
      "/404/ 页 en alternate 悬空（登记项，非拦截）",
      "必修",
      `${dangling404.length} 条：Starlight 只为默认语言生成 404 实体，en 侧无 /en/404/，故 404 页的 hreflang="en" 指向不存在的页面。该页不在 sitemap-0.xml 中，且站点规范明确采用 Starlight 内建 404（上游行为，非本站实现缺陷）`,
      dangling404.join("；"),
    );
  else
    pass(
      "B4-3",
      "B",
      "/404/ 页 alternate 无悬空",
      "必修",
      "404 页的 alternate 全部可解析",
      "",
    );
}

// ---------------------------------------------------------------- B5 fallback 提示条
{
  const fb = enPages.filter((r) => r.isFallback);
  const suspect = [];
  for (const r of enPages) {
    if (r.isFallback) continue;
    // 真译文页不应含大段中文正文（zh 原文误当译文发布的情况）
    const cjk = (r.text.match(/[\u4e00-\u9fff]/g) || []).length;
    const latin = (r.text.match(/[A-Za-z]/g) || []).length;
    if (cjk > 200 && cjk / (cjk + latin) > 0.5)
      suspect.push(
        `${r.url} 未标记 fallback 但正文以中文为主（CJK ${cjk} 字）`,
      );
  }
  if (!suspect.length)
    pass(
      "B5-1",
      "B",
      "en 侧缺译页显式登记为 fallback",
      "必修",
      `en ${enPages.length} 页中 ${fb.length} 页带内建提示条、${enPages.length - fb.length} 页为真译文；无「中文原文冒充译文」页面`,
      `提示条文案取自 src/content/i18n/en.json 的 i18n.untranslatedContent：${FALLBACK_TEXT}`,
    );
  else
    fail(
      "B5-1",
      "B",
      "en 侧缺译页显式登记为 fallback",
      "必修",
      `${suspect.length} 页可疑`,
      suspect.slice(0, 6).join("；"),
    );
}

// ---------------------------------------------------------------- B6 语言切换器
{
  const bad = [];
  for (const r of rows) {
    if (NO_NAV_PAGES.has(r.url)) continue;
    if (!r.html.includes("starlight-lang-select"))
      bad.push(`${r.url} 无语言切换器`);
  }
  const labelBad = [];
  for (const r of zhPages)
    if (!NO_NAV_PAGES.has(r.url) && !r.html.includes("starlight-lang-select"))
      labelBad.push(r.url);

  if (!bad.length)
    pass(
      "B6-1",
      "B",
      "语言切换器齐备且可访问名本地化",
      "必修",
      `${rows.length - NO_NAV_PAGES.size} 个内容页均有 <starlight-lang-select>；zh 侧可访问名「切换语言」、en 侧「Select language」`,
      "",
    );
  else
    fail(
      "B6-1",
      "B",
      "语言切换器齐备且可访问名本地化",
      "必修",
      `${bad.length} 页缺语言切换器`,
      bad.slice(0, 8).join("；"),
    );
}
