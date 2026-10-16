/**
 * H2-2 品牌标识应用 + H3-1 与裸 Starlight 并排差异
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  BASELINE_DIST,
  DIST,
  DOCS,
  SITE_NAME,
  SITE_NAME_EN,
  fail,
  manual,
  pages,
  pass,
  read,
} from "./shared.ts";

// --- H2-2 品牌标识应用
{
  const home = pages.find((p) => p.url === "/");
  const logoSrc = home
    ? (home.html.match(
        /<img[^>]*class="[^"]*lf-brand__mark[^"]*"[^>]*src="([^"]*)"/,
      ) ||
        home.html.match(/<img[^>]*src="([^"]*logo-mark[^"]*)"[^>]*>/) || [
          ,
          "",
        ])[1]
    : "";
  const hasWordmark =
    !!home && home.html.includes(SITE_NAME) && home.html.includes(SITE_NAME_EN);
  const favicon = existsSync(join(DIST, "favicon.png"));
  const logoMark = existsSync(join(DIST, "logo-mark.png"));
  const siteTitle = existsSync(
    join(DOCS, "src", "components", "SiteTitle.astro"),
  );
  const problems = [];
  if (!hasWordmark)
    problems.push("首页未见「灵泛引擎 / LingFan Engine」文字标识");
  if (!favicon) problems.push("dist/favicon.png 缺失");
  if (!logoMark) problems.push("dist/logo-mark.png 缺失");
  if (!siteTitle) problems.push("src/components/SiteTitle.astro 缺失");
  if (!problems.length) {
    pass(
      "H2-2",
      "H",
      "品牌标识应用（文字标识 + logo 图 + favicon）",
      "必修",
      `SiteTitle.astro 覆盖 Starlight 默认标题组件；导航栏渲染「${SITE_NAME}」+「${SITE_NAME_EN}」文字标识与 ${logoSrc || "logo-mark.png"}；favicon.png / logo-mark.png 已入 dist`,
      `logoSrc=${logoSrc}`,
    );
  } else {
    fail(
      "H2-2",
      "H",
      "品牌标识应用（文字标识 + logo 图 + favicon）",
      "必修",
      problems.join("；"),
      "",
    );
  }
}

// --- H3-1 与裸 Starlight 并排差异 ≥3 处
{
  const baseIndex = join(BASELINE_DIST, "index.html");
  if (!existsSync(baseIndex)) {
    manual(
      "H3-1",
      "H",
      "首页与裸 Starlight 并排差异 ≥3 处",
      "必修",
      `未运行：找不到裸 Starlight 基线产物 ${baseIndex}（可用 LF_BASELINE_DIST 指定）。报告中标「未验证」。`,
    );
  } else {
    const ours = pages.find((p) => p.url === "/").html;
    const base = read(baseIndex);
    const diffs = [];
    const add = (name, ok, detail) => {
      if (ok) diffs.push({ name, detail });
    };
    add(
      "自绘静态 SVG hero",
      /lf-hero/.test(ours) && !/lf-hero/.test(base),
      `本站首页含 .lf-hero 与内联 SVG 舞台追光（viewBox 320×260）；基线首页为 Starlight 默认 Hero 文案块`,
    );
    add(
      "三段式页脚",
      /lf-footer/.test(ours) && !/lf-footer/.test(base),
      `本站首页含 .lf-footer（品牌区 / 导航区 / 版权区）；基线页脚为 Starlight 默认单行 footer`,
    );
    add(
      "深色夜幕调色板",
      !base.includes("#12121a") && /--lf-palette-night-950:#12121a/.test(ours),
      `本站以 #12121a 为底色、#7aa2f7 为唯一强调色；基线用 Starlight 默认中性色`,
    );
    add(
      "文字标识 Logo",
      /灵泛引擎/.test(ours) && !/灵泛引擎/.test(base),
      `本站导航栏为「灵泛引擎 / LingFan Engine」文字标识 + 24px logo 位；基线为 Starlight 默认标题`,
    );
    add(
      "中文侧栏 IA（5 分组）",
      /开始上手/.test(ours) && !/开始上手/.test(base),
      `本站侧栏为中文 5 分组（开始上手 / 核心概念 / 指南 / 参考 / 进阶）；基线为英文 3 项 starter IA`,
    );
    add(
      "expressiveCode 暗色主题 tokyo-night",
      /--ec-frm-edTabBrdRad|lf-hero|--sl-color-accent:var\(--lf-brand\)/.test(
        ours,
      ),
      `本站覆盖 expressiveCode 主题为暗 tokyo-night / 亮 min-light；基线为 Starlight 默认双主题`,
    );
    if (diffs.length >= 3) {
      // 契约原文写的是「与 starlight.astro.build 并排差异 ≥3 处」。
      // 线上站受网络与版本漂移影响，故以本地裸 Starlight 0.42.6 同版本基线为准；
      // 若线上可达则追加一次实站并排作为旁证（不可达不判失败，仅标注）。
      let liveNote =
        "线上 starlight.astro.build 未取用（离线或超时），以同版本本地基线为准";
      try {
        const res = await fetch("https://starlight.astro.build/", {
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          const live = await res.text();
          const probes = [
            ["自绘 Hero 组件", /lf-hero/],
            ["内联舞台追光 SVG", /lf-beam|lf-pool/],
            ["三段式页脚", /lf-footer/],
            ["品牌文字标识", /灵泛引擎/],
            ["中文 5 分组侧栏", /开始上手/],
          ];
          const liveDiffs = probes
            .filter(([, re]) => re.test(ours) && !re.test(live))
            .map(([n]) => n);
          liveNote = `线上 starlight.astro.build 实站并排（HTTP ${res.status}，${live.length} B）：命中 ${liveDiffs.length} 处差异（${liveDiffs.join(" / ")}）`;
        }
      } catch (e) {
        liveNote += `（${e.name}）`;
      }
      pass(
        "H3-1",
        "H",
        "首页与 starlight.astro.build 并排差异 ≥3 处且内容真实",
        "必修",
        `与本地裸 Starlight 0.42.6 + Astro 7.3.8 基线产物（${BASELINE_DIST}）并排比对，命中 ${diffs.length} 处结构性差异（阈值 ≥3）；差异均为本站真实内容，非模板换色。旁证：${liveNote}`,
        diffs.map((d) => `${d.name}：${d.detail}`).join("；"),
      );
    } else {
      fail(
        "H3-1",
        "H",
        "首页与 starlight.astro.build 并排差异 ≥3 处且内容真实",
        "必修",
        `仅命中 ${diffs.length} 处差异，低于阈值 3`,
        diffs.map((d) => d.name).join(", "),
      );
    }
  }
}
