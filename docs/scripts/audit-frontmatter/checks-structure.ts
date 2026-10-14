/**
 * audit-frontmatter · E 组静态结构检查（h1、层级、landmark、SVG/img、焦点序、nav）
 */
import { ancestorHidden, fail, pass, rows } from "./shared.ts";

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
  // 判定范围：splash 首页（/ 与 /en/）与 404 不渲染侧栏，nav 数为 0 属预期；
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
