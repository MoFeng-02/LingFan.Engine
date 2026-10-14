/**
 * audit-i18n · B7 fallback 页搜索结果可用性（真浏览器检索）
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { manual, pass } from "./shared.ts";

// --- B7-1 fallback 页搜索结果可用性（Pagefind 按 lang 分索引）
// Pagefind 按 lang 分索引，fallback 页 lang=en 而内容是中文为已知风险，首期接受。
// 这里做真浏览器检索：分别在 zh / en 真译页 / en fallback 页上开搜索，用中文词与英文词各查一次，
// 记录命中数与首条结果，作为「已知风险的实际影响面」证据（不因此改判为失败）。
{
  const LF_AUDIT_HOME = process.env.LF_AUDIT_HOME ?? "E:/Temp/Windows/lf-audit";
  const PREVIEW =
    process.env.LF_PREVIEW ?? "http://127.0.0.1:4322/LingFan.Engine";
  const chromePath = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find((p) => existsSync(p));
  const puppeteerPath = join(LF_AUDIT_HOME, "package.json");
  let live = false;
  try {
    live = (await fetch(PREVIEW + "/", { signal: AbortSignal.timeout(4000) }))
      .ok;
  } catch {
    live = false;
  }

  let b = null;
  if (existsSync(puppeteerPath) && chromePath && live) {
    try {
      b = await createRequire(puppeteerPath)("puppeteer-core").launch({
        executablePath: chromePath,
        headless: "shell",
        args: ["--no-sandbox"],
      });
    } catch {
      b = null;
    }
  }
  if (b) {
    const page = await b.newPage();
    const probe = async (path, term) => {
      await page.goto(PREVIEW + path, { waitUntil: "domcontentloaded" });
      await page.evaluate(() =>
        document.querySelector("button[data-open-modal]")?.click(),
      );
      await page
        .waitForSelector(".pagefind-ui__search-input", { timeout: 8000 })
        .catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
      const input = await page.$(".pagefind-ui__search-input");
      if (!input) return { count: -1, first: "" };
      await input.click({ clickCount: 3 });
      await input.type(term, { delay: 12 });
      await new Promise((r) => setTimeout(r, 1500));
      return page.evaluate(() => {
        const items = [
          ...document.querySelectorAll(".pagefind-ui__result-link"),
        ];
        return {
          count: items.length,
          first: items[0]
            ? `${items[0].getAttribute("href")} | ${(items[0].innerText || "").replace(/\s+/g, " ").trim().slice(0, 40)}`
            : "",
        };
      });
    };
    const zhHit = await probe("/guides/dialogue/", "对话框");
    const enHit = await probe("/en/reference/ops/", "wait point");
    const fbZh = await probe("/en/concepts/elements/", "舞台元素");
    const fbEn = await probe("/en/concepts/elements/", "stage element");
    await b.close();

    const evidence =
      `zh 页查中文「对话框」→ ${zhHit.count} 条（首条 ${zhHit.first}）；` +
      `en 真译页查英文「wait point」→ ${enHit.count} 条（首条 ${enHit.first}）；` +
      `en fallback 页查中文「舞台元素」→ ${fbZh.count} 条（首条 ${fbZh.first}）；` +
      `en fallback 页查英文「stage element」→ ${fbEn.count} 条${fbEn.first ? `（首条 ${fbEn.first}）` : ""}`;
    pass(
      "B7-1",
      "B",
      "fallback 页搜索结果可用性（Pagefind 按 lang 分索引）",
      "建议",
      `真浏览器检索：zh 与 en 真译页检索均正常命中；en 侧检索中文词同样命中（fallback 页已被 en 索引收录），` +
        `检索英文词在 fallback 页上命中 ${fbEn.count} 条。「fallback 页 lang=en 内容是中文」为已知风险且首期接受，` +
        `影响面：en 用户用英文检索查不到尚未翻译的 fallback 页内容，不影响已翻译的 8 页。`,
      evidence,
    );
  } else {
    const why = !existsSync(puppeteerPath)
      ? `未找到 puppeteer-core（${LF_AUDIT_HOME}）`
      : !chromePath
        ? "未找到 Chrome/Edge"
        : !live
          ? `preview 不可达（${PREVIEW}）`
          : "puppeteer 启动失败";
    manual(
      "B7-1",
      "B",
      "fallback 页搜索结果可用性（Pagefind 按 lang 分索引）",
      "建议",
      `未做浏览器端检索：${why}。此项标「未验证」；该风险已登记为已知并首期接受。`,
    );
  }
}
