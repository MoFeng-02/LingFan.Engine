/**
 * audit-ia · F 组 · 浏览器检查（响应式五档 + 移动菜单焦点管理）
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import {
  CHROME_CANDIDATES,
  PREVIEW,
  PUPPETEER_CANDIDATES,
  fail,
  manual,
  pass,
} from "./shared.ts";

const isAlive = async (url) => {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
};
const puppeteerPath = PUPPETEER_CANDIDATES.find((p) => existsSync(p));
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
export const live = await isAlive(PREVIEW + "/");

if (!puppeteerPath || !chromePath || !live) {
  const why = !puppeteerPath
    ? `未找到 puppeteer-core（探测：${PUPPETEER_CANDIDATES.join(" | ")}）`
    : !chromePath
      ? "未找到本机 Chrome / Edge"
      : `preview 未在 ${PREVIEW} 响应（先执行 cd docs && npx astro preview --port 4322）`;
  manual(
    "F1-1",
    "F",
    "320/375/768/1024/1440 五档无页面级横向滚动",
    "拦截",
    `${why}；未验证`,
  );
  manual(
    "F2-1",
    "F",
    "移动菜单焦点管理（打开时主内容 inert、Escape 关闭恢复）",
    "必修",
    `${why}；未验证`,
  );
} else {
  const req = createRequire(puppeteerPath);
  const puppeteer = req("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "shell",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  const SAMPLE = [
    ["首页", "/"],
    ["指南页", "/guides/dialogue/"],
    ["最重 op 域页", "/reference/ops/stage/"],
    ["其 en 对应页", "/en/reference/ops/"],
  ];
  const WIDTHS = [320, 375, 768, 1024, 1440];
  const scrollFail = [];
  const measurements = [];
  try {
    for (const [name, p] of SAMPLE) {
      await page.goto(PREVIEW + p, { waitUntil: "networkidle2" });
      for (const w of WIDTHS) {
        await page.setViewport({ width: w, height: 900 });
        await new Promise((r) => setTimeout(r, 200));
        const m = await page.evaluate(() => ({
          doc: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        measurements.push(`${p}@${w}=${m.doc}`);
        if (m.doc > m.client + 1 || m.body > m.client + 1)
          scrollFail.push(
            `${name}${p} @${w}px（scrollWidth ${m.doc} > clientWidth ${m.client}）`,
          );
      }
    }
    if (!scrollFail.length) {
      pass(
        "F1-1",
        "F",
        "320/375/768/1024/1440 五档无页面级横向滚动",
        "拦截",
        `受检集合 ${SAMPLE.length} 页 × 5 档 = ${measurements.length} 次测量，documentElement.scrollWidth 恒等于 clientWidth`,
        `受检：${SAMPLE.map((s) => s[1]).join(", ")}；宽度 ${WIDTHS.join("/")}`,
      );
    } else {
      fail(
        "F1-1",
        "F",
        "320/375/768/1024/1440 五档无页面级横向滚动",
        "拦截",
        `${scrollFail.length} 处横向溢出`,
        scrollFail.join("; "),
      );
    }

    // 移动菜单焦点管理
    await page.setViewport({ width: 375, height: 812 });
    await page.goto(PREVIEW + "/guides/dialogue/", {
      waitUntil: "networkidle2",
    });
    const before = await page.evaluate(() => ({
      display: getComputedStyle(document.querySelector("sl-sidebar-pane"))
        .display,
      mainInert: document.querySelector(".main-frame").hasAttribute("inert"),
    }));
    await page.click(".sl-menu-button");
    await new Promise((r) => setTimeout(r, 300));
    const opened = await page.evaluate(() => ({
      display: getComputedStyle(document.querySelector("sl-sidebar-pane"))
        .display,
      mainInert: document.querySelector(".main-frame").hasAttribute("inert"),
      skipInert: document.querySelector(".sl-skip-link").hasAttribute("inert"),
    }));
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 300));
    const closed = await page.evaluate(() => ({
      display: getComputedStyle(document.querySelector("sl-sidebar-pane"))
        .display,
      mainInert: document.querySelector(".main-frame").hasAttribute("inert"),
    }));
    const ok =
      before.display === "none" &&
      !before.mainInert &&
      opened.display !== "none" &&
      opened.mainInert &&
      opened.skipInert &&
      closed.display === "none" &&
      !closed.mainInert;
    const detail = `打开前 display=${before.display}/main inert=${before.mainInert}；打开后 display=${opened.display}/main inert=${opened.mainInert}/skip-link inert=${opened.skipInert}；Escape 后 display=${closed.display}/main inert=${closed.mainInert}`;
    if (ok)
      pass(
        "F2-1",
        "F",
        "移动菜单焦点管理（打开时主内容 inert、Escape 关闭恢复）",
        "必修",
        detail,
        "Starlight sl-sidebar-pane 的 trapFocus() 对 .main-frame 与 .sl-skip-link 切换 inert 属性",
      );
    else
      fail(
        "F2-1",
        "F",
        "移动菜单焦点管理（打开时主内容 inert、Escape 关闭恢复）",
        "必修",
        detail,
        "",
      );
  } finally {
    await browser.close();
  }
}
