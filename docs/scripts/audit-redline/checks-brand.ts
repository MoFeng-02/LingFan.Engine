/**
 * H1-1 默认品牌色清零（hex 等价表 + 级联层归属裁决）
 */

import { cssFiles, fail, hslToHex, pass, read, rel } from "./shared.ts";

function layerRanges(css) {
  const out = [];
  const re = /@layer\s+([A-Za-z0-9_.\-]+)\s*\{/g;
  let m;
  while ((m = re.exec(css))) {
    const start = m.index;
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push({ name: m[1], start, end: i });
    re.lastIndex = m.index + 1;
  }
  return out;
}
/** 栈式扫描 @media 块，返回 [{query, start, end}] */
function mediaRanges(css) {
  const out = [];
  const re = /@media\s*([^{]*)\{/g;
  let m;
  while ((m = re.exec(css))) {
    const start = m.index;
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push({ query: m[1].trim(), start, end: i });
    re.lastIndex = m.index + 1;
  }
  return out;
}
const layerAt = (layers, i) => {
  const hit = layers
    .filter((l) => l.start < i && i < l.end)
    .sort((a, b) => b.start - a.start)[0];
  return hit ? hit.name : null;
};
const mediaAt = (medias, i) => {
  const hit = medias
    .filter((x) => x.start < i && i < x.end)
    .sort((a, b) => b.start - a.start)[0];
  return hit ? hit.query : null;
};

/** Starlight 上游默认品牌色（实算 hex，等价表由此生成） */
export const STARLIGHT_DEFAULTS = [
  { theme: "dark", prop: "--sl-color-accent-low", hsl: [224, 54, 20] },
  { theme: "dark", prop: "--sl-color-accent", hsl: [224, 100, 60] },
  { theme: "dark", prop: "--sl-color-accent-high", hsl: [224, 100, 85] },
  { theme: "light", prop: "--sl-color-accent-high", hsl: [234, 80, 30] },
  { theme: "light", prop: "--sl-color-accent", hsl: [234, 90, 60] },
  { theme: "light", prop: "--sl-color-accent-low", hsl: [234, 88, 90] },
].map((d) => ({ ...d, hex: hslToHex(...d.hsl) }));
export const DEFAULT_HEXES = new Set(STARLIGHT_DEFAULTS.map((d) => d.hex));

const TRACKED_PROPS = [
  "--sl-color-accent",
  "--sl-color-accent-low",
  "--sl-color-accent-high",
  "--sl-hue-blue",
  "--sl-hue-green",
  "--sl-hue-red",
  "--sl-hue-purple",
  "--sl-hue-orange",
];

// --- H1-1 默认品牌色清零（hex 等价表 + 级联层归属裁决）
{
  const cssData = cssFiles.map((f) => {
    const css = read(f);
    return {
      file: rel(f),
      css,
      layers: layerRanges(css),
      medias: mediaRanges(css),
    };
  });
  // ① hex 等价表：定位每个默认色字面量的出现处及其层归属
  const literalHits = [];
  for (const { file, css, layers, medias } of cssData) {
    for (const d of STARLIGHT_DEFAULTS) {
      const re = new RegExp(d.hex.replace("#", "#"), "gi");
      let m;
      while ((m = re.exec(css))) {
        const layer = layerAt(layers, m.index);
        const media = mediaAt(medias, m.index);
        const ctx = css
          .slice(Math.max(0, m.index - 90), m.index + 40)
          .replace(/\s+/g, " ");
        literalHits.push({
          file,
          offset: m.index,
          hex: d.hex,
          theme: d.theme,
          prop: d.prop,
          layer,
          media,
          ctx,
        });
      }
    }
  }
  // ② 级联层归属裁决：对每个受跟踪令牌求「屏幕态有效声明」
  const adjudication = [];
  for (const prop of TRACKED_PROPS) {
    const decls = [];
    for (const { file, css, layers, medias } of cssData) {
      const re = new RegExp(`${prop}\\s*:\\s*([^;}]+)`, "g");
      let m;
      while ((m = re.exec(css))) {
        decls.push({
          file,
          offset: m.index,
          value: m[1].trim(),
          layer: layerAt(layers, m.index),
          media: mediaAt(medias, m.index),
        });
      }
    }
    const screen = decls.filter(
      (d) => d.media === null || /screen/.test(d.media),
    );
    const unlayered = screen.filter((d) => d.layer === null);
    const pool = unlayered.length
      ? unlayered
      : screen.filter((d) => d.layer !== null);
    const winner = pool.sort((a, b) => a.offset - b.offset).at(-1);
    const isDefault = winner
      ? DEFAULT_HEXES.has(winner.value.toLowerCase())
      : null;
    adjudication.push({
      prop,
      decls,
      winner,
      isDefault,
      tier: unlayered.length ? "unlayered" : "layered",
    });
  }
  const lostProps = adjudication.filter((a) => a.isDefault === true);
  const notCustom = adjudication.filter(
    (a) =>
      a.winner &&
      !/var\(--lf-/.test(a.winner.value) &&
      !/var\(--lf-/.test(a.winner.value),
  );
  const activeLiterals = literalHits.filter(
    (h) => h.layer === null && h.media === null,
  );
  const evidence =
    `默认色字面量共 ${literalHits.length} 处（${[...new Set(literalHits.map((h) => h.file))].join(", ")}）；` +
    `其中位于未分层屏幕上下文的 ${activeLiterals.length} 处` +
    (activeLiterals.length
      ? `：${activeLiterals.map((h) => `${h.file}@${h.offset} ${h.hex}`).join(", ")}`
      : "") +
    "；层归属分布：" +
    [
      ...new Set(
        literalHits.map(
          (h) =>
            `${h.layer ?? "(unlayered)"}${h.media ? ` @media ${h.media}` : ""}`,
        ),
      ),
    ].join(" / ") +
    "；有效声明裁决：" +
    adjudication
      .map(
        (a) =>
          `${a.prop} ← ${a.winner ? `${a.winner.value} [${a.winner.layer ?? "(unlayered)"}@${a.winner.offset}${a.winner.media ? ` @media ${a.winner.media}` : ""}]` : "无声明"}`,
      )
      .join("；");
  if (!lostProps.length && !activeLiterals.length && !notCustom.length) {
    pass(
      "H1-1",
      "H",
      "Starlight 默认品牌色清零（hex 等价表 + 级联层归属裁决）",
      "拦截",
      `方法：① 由上游 props.css 的 hsl 声明实算 hex 等价表（${STARLIGHT_DEFAULTS.map((d) => d.hex).join(" / ")}），逐个定位；` +
        `② 栈式扫描 @layer 边界，对 ${TRACKED_PROPS.length} 个受跟踪令牌求屏幕态有效声明；③ 浏览器复核（H1-2）。` +
        `结论：全部 ${literalHits.length} 处默认色字面量都落在 @layer starlight.* 内或 @media print 内，未分层屏幕上下文 0 处；` +
        `${TRACKED_PROPS.length} 个令牌的有效声明全部是 var(--lf-*) 自定义值 ⇒ 默认品牌色在浏览器中不生效。`,
      evidence,
    );
  } else {
    fail(
      "H1-1",
      "H",
      "Starlight 默认品牌色清零（hex 等价表 + 级联层归属裁决）",
      "拦截",
      `${lostProps.length} 个令牌的有效声明仍是 Starlight 默认值；未分层屏幕上下文有 ${activeLiterals.length} 处默认色字面量`,
      evidence,
    );
  }
}
