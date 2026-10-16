/**
 * H1-2 浏览器运行时复核（puppeteer 启动 + 令牌探针，顶层 await）
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import {
  CHROME_CANDIDATES,
  LF_AUDIT_HOME,
  PREVIEW,
  fail,
  manual,
  pass,
} from "./shared.ts";
import { DEFAULT_HEXES } from "./checks-brand.ts";

// --- H1-2 品牌标识 / 首页差异：浏览器检查（与 H1-1 的静态裁决互为佐证）
const PUPPETEER_CANDIDATES = [
  process.env.LF_AUDIT_HOME && join(process.env.LF_AUDIT_HOME, "package.json"),
  join(LF_AUDIT_HOME, "package.json"),
].filter(Boolean);
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
export const axePath = join(
  LF_AUDIT_HOME,
  "node_modules",
  "axe-core",
  "axe.min.js",
);
export let live = false;
try {
  const r = await fetch(PREVIEW + "/", { signal: AbortSignal.timeout(4000) });
  live = r.ok;
} catch {
  live = false;
}
const puppeteerPath = PUPPETEER_CANDIDATES.find((p) => existsSync(p));

export let browser = null;
let puppeteer = null;
if (puppeteerPath && chromePath && live) {
  try {
    puppeteer = createRequire(puppeteerPath)("puppeteer-core");
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: "shell",
      args: ["--no-sandbox"],
    });
  } catch {
    browser = null;
  }
}
export const browserReady = !!browser;
export const browserWhy = !puppeteerPath
  ? `未找到 puppeteer-core（探测：${PUPPETEER_CANDIDATES.join(" | ")}）`
  : !chromePath
    ? `未找到 Chrome/Edge（探测：${CHROME_CANDIDATES.join(" | ")}）`
    : !live
      ? `preview 不可达（${PREVIEW}）`
      : browser
        ? ""
        : "puppeteer 启动失败";

const PROBE_PAGE = "/guides/dialogue/";
export const SAMPLE = [
  "/",
  "/guides/dialogue/",
  "/reference/ops/stage/",
  "/en/reference/ops/",
];
let tokenProbe = null;
if (browserReady) {
  const page = await browser.newPage();
  const themeOf = async (theme) => {
    await page.evaluateOnNewDocument((t) => {
      try {
        localStorage.setItem("starlight-theme", t);
      } catch {}
    }, theme);
    await page.goto(PREVIEW + PROBE_PAGE, { waitUntil: "domcontentloaded" });
    return page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const pick = (n) => cs.getPropertyValue(n).trim();
      return {
        theme: document.documentElement.dataset.theme ?? null,
        accent: pick("--sl-color-accent"),
        accentLow: pick("--sl-color-accent-low"),
        accentHigh: pick("--sl-color-accent-high"),
        hueBlue: pick("--sl-hue-blue"),
        bg: pick("--sl-color-bg"),
        font: pick("--sl-font"),
        fontMono: pick("--sl-font-mono"),
        lfBrand: pick("--lf-brand"),
      };
    });
  };
  tokenProbe = { dark: await themeOf("dark"), light: await themeOf("light") };
  await page.close();
}

// --- H1-2 默认品牌色在浏览器中确实未生效（运行时复核）
{
  if (!browserReady) {
    manual(
      "H1-2",
      "H",
      "默认品牌色运行时复核（getComputedStyle 解析值）",
      "拦截",
      `未运行：${browserWhy}。静态裁决见 H1-1；此项在报告中标「未验证」。`,
    );
  } else {
    const bad = [];
    for (const theme of ["dark", "light"]) {
      const p = tokenProbe[theme];
      for (const [k, v] of [
        ["accent", p.accent],
        ["accent-low", p.accentLow],
        ["accent-high", p.accentHigh],
      ]) {
        if (DEFAULT_HEXES.has(String(v).toLowerCase()))
          bad.push(`${theme} --sl-color-${k} = ${v}（Starlight 默认值）`);
      }
      if (String(p.hueBlue).trim() === "234")
        bad.push(`${theme} --sl-hue-blue = 234（Starlight 默认值）`);
    }
    const evidence = ["dark", "light"]
      .map((t) => {
        const p = tokenProbe[t];
        return `${t}: accent ${p.accent} / accent-low ${p.accentLow} / accent-high ${p.accentHigh} / hue-blue ${p.hueBlue} / bg ${p.bg} / --lf-brand ${p.lfBrand}`;
      })
      .join("；");
    if (!bad.length) {
      pass(
        "H1-2",
        "H",
        "默认品牌色运行时复核（getComputedStyle 解析值）",
        "拦截",
        `受检页 ${PROBE_PAGE} 亮暗两态下 --sl-color-accent{,-low,-high} 与 --sl-hue-blue 均非 Starlight 默认值（${[...DEFAULT_HEXES].join(" / ")} / 234），与 H1-1 静态裁决一致`,
        evidence,
      );
    } else {
      fail(
        "H1-2",
        "H",
        "默认品牌色运行时复核（getComputedStyle 解析值）",
        "拦截",
        bad.join("；"),
        evidence,
      );
    }
  }
}
