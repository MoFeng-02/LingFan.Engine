/**
 * audit-frontmatter · 键盘走查（Tab 顺序、焦点可见、skip link）。
 * 静态产物无法判定真实焦点行为，有浏览器时做真键盘走查；
 * 缺任一前置条件则退回 MANUAL 并写明原因（不静默判过）。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fail, manual, pass } from "./shared.ts";

const LF_AUDIT_HOME = process.env.LF_AUDIT_HOME ?? "E:/Temp/Windows/lf-audit";
const PREVIEW =
  process.env.LF_PREVIEW ?? "http://127.0.0.1:4322/LingFan.Engine";
const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
const puppeteerPath = [join(LF_AUDIT_HOME, "package.json")].find((p) =>
  existsSync(p),
);
let live = false;
try {
  live = (await fetch(PREVIEW + "/", { signal: AbortSignal.timeout(4000) })).ok;
} catch {
  live = false;
}

let kbBrowser = null;
if (puppeteerPath && chromePath && live) {
  try {
    kbBrowser = await createRequire(puppeteerPath)("puppeteer-core").launch({
      executablePath: chromePath,
      headless: "shell",
      args: ["--no-sandbox"],
    });
  } catch {
    kbBrowser = null;
  }
}
if (kbBrowser) {
  const kbWhy = [];
  const page = await kbBrowser.newPage();
  const activeInfo = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName,
        text: (el.innerText || el.getAttribute("aria-label") || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 32),
        href: el.getAttribute("href") || "",
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
      };
    });
  const focusable = [];
  let noRing = 0;
  for (const probe of ["/guides/dialogue/", "/en/reference/ops/"]) {
    await page.goto(PREVIEW + probe, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.body.focus());
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Tab");
      const a = await activeInfo();
      if (!a) break;
      focusable.push(a);
      if (a.outlineStyle === "none" || a.outlineWidth === "0px") noRing++;
    }
    // Shift+Tab 反向必须能回到上一节点
    const before = await activeInfo();
    await page.keyboard.down("Shift");
    await page.keyboard.press("Tab");
    await page.keyboard.up("Shift");
    const after = await activeInfo();
    if (before && after && before.text === after.text)
      kbWhy.push(`${probe} Shift+Tab 未反向移动`);
  }
  // skip link：首次 Tab 命中（Starlight 内建跳转链接指向 #_top），Enter 后 URL 带 #_top
  await page.goto(PREVIEW + "/guides/dialogue/", {
    waitUntil: "domcontentloaded",
  });
  await page.keyboard.press("Tab");
  const first = await activeInfo();
  if (!first || first.href !== "#_top")
    kbWhy.push(
      `首个 Tab 焦点不是 skip link（测得「${first?.text ?? "null"}」href=${first?.href ?? "-"}）`,
    );
  else {
    await page.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 300));
    if (!page.url().includes("#_top"))
      kbWhy.push(`skip link 回车后 URL 未带 #_top（测得 ${page.url()}）`);
  }
  if (noRing) kbWhy.push(`${noRing} 个焦点节点无可见焦点环`);
  await kbBrowser.close();

  const ringSample = focusable.filter((f) => f.outlineStyle !== "none").length;
  if (!kbWhy.length) {
    pass(
      "E2-1",
      "E",
      "键盘走查（Tab 顺序、焦点可见、skip link）",
      "拦截",
      `真键盘走查：2 个受检页各 14 次 Tab，${focusable.length} 个焦点节点全部有可见焦点环（品牌色 outline），Shift+Tab 可反向，skip link 首次 Tab 命中且回车跳 #_top`,
      `焦点序列样本：${focusable
        .slice(0, 5)
        .map((f) => `${f.tag}「${f.text}」`)
        .join(" → ")}…；有焦点环节点 ${ringSample}/${focusable.length}`,
    );
  } else {
    fail(
      "E2-1",
      "E",
      "键盘走查（Tab 顺序、焦点可见、skip link）",
      "拦截",
      kbWhy.join("；"),
      "",
    );
  }
} else {
  const why = !puppeteerPath
    ? `未找到 puppeteer-core（${LF_AUDIT_HOME}）`
    : !chromePath
      ? "未找到 Chrome/Edge"
      : !live
        ? `preview 不可达（${PREVIEW}）`
        : "puppeteer 启动失败";
  manual(
    "E2-1",
    "E",
    "键盘走查（Tab 顺序、焦点可见、skip link）",
    "拦截",
    `未做浏览器端键盘走查：${why}。此项标「未验证」，须人工走查。`,
  );
}
