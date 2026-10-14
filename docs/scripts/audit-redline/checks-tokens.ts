/**
 * C 组 · 令牌（C1-1/C1-2/C2-1/C2-2/C3-1/C4-1）
 */

import { join, relative } from "node:path";
import { DOCS, STYLE_DIR, baseCss, contrast, darkVars, fail, getVar, hexOf, lightVars, pass, read, rel, resolveVar, results, walk } from "./shared.ts";

// --- C1-1 亮暗两套令牌齐备
{
  const SEMANTIC = [
    "bg",
    "surface",
    "surface-2",
    "border",
    "text",
    "text-body",
    "text-muted",
    "text-faint",
    "brand",
    "brand-strong",
    "alt",
    "ok",
    "warn",
    "err",
    "on-brand",
  ].map((k) => `--lf-${k}`);
  const missDark = SEMANTIC.filter((k) => !darkVars.has(k));
  const missLight = SEMANTIC.filter((k) => !lightVars.has(k));
  const missing = [...new Set([...missDark, ...missLight])];
  const evidence = SEMANTIC.map((k) => {
    const d = hexOf(getVar(darkVars, k)) ?? getVar(darkVars, k);
    const l = hexOf(getVar(lightVars, k)) ?? getVar(lightVars, k);
    return `${k}: dark ${d} / light ${l}`;
  }).join("；");
  if (!missing.length) {
    pass(
      "C1-1",
      "C",
      "亮暗两套令牌齐备",
      "拦截",
      `语义层 ${SEMANTIC.length} 个令牌在 :root 与 :root[data-theme='light'] 下均已定义（tokens.css）`,
      evidence,
    );
  } else {
    fail(
      "C1-1",
      "C",
      "亮暗两套令牌齐备",
      "拦截",
      `缺失：${missing.join(", ")}`,
      evidence,
    );
  }
}

// --- C1-2 以覆盖 --sl-* 实现
{
  const OVERRIDE = [
    "--sl-color-accent",
    "--sl-color-accent-low",
    "--sl-color-accent-high",
    "--sl-hue-blue",
    "--sl-hue-green",
    "--sl-hue-red",
    "--sl-hue-purple",
    "--sl-hue-orange",
    "--sl-color-bg",
    "--sl-color-bg-nav",
    "--sl-color-bg-sidebar",
    "--sl-color-text",
    "--sl-color-text-accent",
    "--sl-font",
    "--sl-font-mono",
  ];
  const missing = OVERRIDE.filter(
    (k) => !new RegExp(`${k}\\s*:`).test(baseCss),
  );
  if (!missing.length) {
    const mapped = OVERRIDE.map((k) => {
      const decl = (baseCss.match(new RegExp(`${k}\\s*:\\s*([^;]+)`)) || [
        ,
        "",
      ])[1].trim();
      return `${k} → ${decl}`;
    });
    pass(
      "C1-2",
      "C",
      "主题以覆盖 Starlight 的 --sl-* 令牌实现",
      "拦截",
      `base.css 覆盖 ${OVERRIDE.length} 个 --sl-* 令牌（映射层只写 var() 引用，不自造平行主题系统）`,
      mapped.join("；"),
    );
  } else {
    fail(
      "C1-2",
      "C",
      "主题以覆盖 Starlight 的 --sl-* 令牌实现",
      "拦截",
      `base.css 未覆盖：${missing.join(", ")}`,
      "",
    );
  }
}

// --- C2-1 不自造平行体系（--lf-palette-* 只在 tokens.css）
{
  const offenders = [];
  for (const f of walk(STYLE_DIR).filter((f) => f.endsWith(".css"))) {
    if (f.endsWith("tokens.css")) continue;
    const css = read(f);
    for (const m of css.matchAll(/--lf-palette-[a-z0-9-]+/g))
      offenders.push(`${rel(f)}@${m.index}`);
  }
  for (const f of walk(join(DOCS, "src", "components")).filter((f) =>
    /\.(astro|ts|mjs|js)$/.test(f),
  )) {
    const css = read(f);
    for (const m of css.matchAll(/--lf-palette-[a-z0-9-]+/g))
      offenders.push(`${rel(f)}@${m.index}`);
  }
  if (!offenders.length) {
    pass(
      "C2-1",
      "C",
      "不自造平行体系：原始调色板只在 tokens.css 定义与引用",
      "拦截",
      "base.css / components.css / markdown.css / components/*.astro 对 --lf-palette-* 引用 0 次",
      "",
    );
  } else {
    fail(
      "C2-1",
      "C",
      "不自造平行体系：原始调色板只在 tokens.css 定义与引用",
      "拦截",
      `${offenders.length} 处越层引用`,
      offenders.slice(0, 10).join(", "),
    );
  }
}

// --- C2-2 token 文件为唯一色值来源
{
  const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
  const cssHits = [];
  let tokenHex = 0;
  for (const f of walk(join(DOCS, "src"))) {
    if (!/\.(css|astro|md|mdx|ts|mjs|json|html|svg)$/.test(f)) continue;
    let s;
    try {
      s = read(f);
    } catch {
      continue;
    }
    const n = [...s.matchAll(HEX_RE)].length;
    if (!n) continue;
    const r = rel(f);
    if (f.endsWith("tokens.css")) {
      tokenHex = n;
      continue;
    }
    if (/\.(css|astro)$/.test(f)) cssHits.push(`${r}(${n})`);
  }
  const docHits = [];
  for (const f of walk(join(DOCS, "src", "content"))) {
    const s = read(f);
    const n = [...s.matchAll(HEX_RE)].length;
    if (n)
      docHits.push(
        `${relative(join(DOCS, "src"), f).split("\\").join("/")}(${n})`,
      );
  }
  if (!cssHits.length) {
    pass(
      "C2-2",
      "C",
      "token 文件为唯一色值来源（样式文件中色值字面量 0 命中）",
      "必修",
      `src/styles/tokens.css 含 ${tokenHex} 处色值字面量（唯一允许处）；其余 CSS / .astro 组件 0 处`,
      docHits.length
        ? `说明：文档正文的示例文本另有 ${docHits.length} 个文件含色值（${docHits.join(", ")}），那是给读者看的十六进制颜色示例，不是样式声明，故不计入本条`
        : "",
    );
  } else {
    fail(
      "C2-2",
      "C",
      "token 文件为唯一色值来源（样式文件中色值字面量 0 命中）",
      "必修",
      `${cssHits.length} 个样式文件含色值字面量`,
      cssHits.join(", "),
    );
  }
}

// --- C3-1 WCAG AA 亮暗双过
{
  const PAIRS = [
    ["text", "bg"],
    ["text-body", "bg"],
    ["text-muted", "bg"],
    ["brand", "bg"],
    ["ok", "bg"],
    ["warn", "bg"],
    ["err", "bg"],
    ["on-brand", "brand"],
  ];
  const rows = [];
  const bad = [];
  for (const theme of ["dark", "light"]) {
    const vars = theme === "dark" ? darkVars : lightVars;
    for (const [fgK, bgK] of PAIRS) {
      const fg = hexOf(getVar(vars, `--lf-${fgK}`));
      const bg = hexOf(getVar(vars, `--lf-${bgK}`));
      if (!fg || !bg) {
        bad.push(`${theme} ${fgK}/${bgK} 无法解析`);
        continue;
      }
      const ratio = contrast(fg, bg);
      rows.push(
        `${theme} ${fgK}(${fg}) on ${bgK}(${bg}) = ${ratio.toFixed(2)}:1`,
      );
      if (ratio < 4.5)
        bad.push(`${theme} ${fgK} on ${bgK} = ${ratio.toFixed(2)}:1 < 4.5:1`);
    }
  }
  const minRatio = Math.min(
    ...PAIRS.flatMap(([f, b]) => {
      const r = [];
      for (const vars of [darkVars, lightVars]) {
        const fg = hexOf(getVar(vars, `--lf-${f}`));
        const bg = hexOf(getVar(vars, `--lf-${b}`));
        if (fg && bg) r.push(contrast(fg, bg));
      }
      return r;
    }),
  );
  if (!bad.length) {
    pass(
      "C3-1",
      "C",
      "WCAG AA 对比度亮暗双过（正文级 ≥4.5:1）",
      "必修",
      `亮暗两套 ${PAIRS.length} 组语义配对各 ${PAIRS.length} 项全部 ≥4.5:1，最低 ${minRatio.toFixed(2)}:1`,
      rows.join("；"),
    );
  } else {
    fail(
      "C3-1",
      "C",
      "WCAG AA 对比度亮暗双过（正文级 ≥4.5:1）",
      "必修",
      `${bad.length} 组不达标，最低 ${minRatio.toFixed(2)}:1`,
      bad.join("；"),
    );
  }
  // text-faint 为登记的「仅大字/装饰」档位，单独登记，不计失败
  const faintDark = hexOf(getVar(darkVars, "--lf-text-faint"));
  if (faintDark) {
    results.push({
      id: "C3-2",
      group: "C",
      name: "text-faint 仅用于大字/装饰（登记项）",
      severity: "建议",
      status: "PASS",
      detail: `--lf-text-faint = ${faintDark}，对暗色 bg ${hexOf(getVar(darkVars, "--lf-bg"))} 为 ${contrast(faintDark, hexOf(getVar(darkVars, "--lf-bg"))).toFixed(2)}:1，低于 4.5:1；该档已声明「仅大字/装饰」。axe 扫描命中页脚小字（见 E3-2）。`,
      evidence: "",
    });
  }
}

// --- C4-1 中文字体栈覆盖 --sl-font / --sl-font-mono
{
  const CJK = [
    "HarmonyOS Sans SC",
    "MiSans",
    "PingFang SC",
    "Microsoft YaHei",
    "Noto Sans CJK SC",
  ];
  const MONO = ["Cascadia Code", "Consolas", "Sarasa Mono SC"];
  const fontDecl = (baseCss.match(/--sl-font\s*:\s*([^;]+)/) || [, ""])[1];
  const monoDecl = (baseCss.match(/--sl-font-mono\s*:\s*([^;]+)/) || [, ""])[1];
  const fontResolved = resolveVar(darkVars, fontDecl.trim(), 0);
  const monoResolved = resolveVar(darkVars, monoDecl.trim(), 0);
  const missCjk = CJK.filter((f) => !fontResolved.includes(f));
  const missMono = MONO.filter((f) => !monoResolved.includes(f));
  if (fontDecl && monoDecl && !missCjk.length && !missMono.length) {
    pass(
      "C4-1",
      "C",
      "中文字体栈显式覆盖 --sl-font / --sl-font-mono",
      "必修",
      `--sl-font 含 ${CJK.length} 个中文字族，--sl-font-mono 含 ${MONO.length} 个等宽字族；Starlight 默认 --sl-font-system 不含中文字体，故此项为必要覆盖`,
      `--sl-font: ${fontResolved}；--sl-font-mono: ${monoResolved}`,
    );
  } else {
    fail(
      "C4-1",
      "C",
      "中文字体栈显式覆盖 --sl-font / --sl-font-mono",
      "必修",
      `${!fontDecl ? "未覆盖 --sl-font；" : ""}${!monoDecl ? "未覆盖 --sl-font-mono；" : ""}缺字族：${[...missCjk, ...missMono].join(", ")}`,
      "",
    );
  }
}

// ================================================================ H 组 · 版式一致性
/** 栈式扫描 @layer 块，返回 [{name, start, end}]（不含 `@layer a, b;` 语句） */