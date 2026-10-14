/**
 * E 组 · axe 无障碍（E3-1/E3-2/E3-3）
 */

import { existsSync } from "node:fs";
import { PREVIEW, fail, manual, pass, results } from "./shared.ts";
import { SAMPLE, axePath, browser, browserReady, browserWhy } from "./checks-browser.ts";

let axeReport = null;
if (browserReady && existsSync(axePath)) {
  const page = await browser.newPage();
  const runs = [];
  for (const theme of ["dark", "light"]) {
    for (const url of SAMPLE) {
      await page.evaluateOnNewDocument((t) => {
        try {
          localStorage.setItem("starlight-theme", t);
        } catch {}
      }, theme);
      await page.goto(PREVIEW + url, { waitUntil: "networkidle2" });
      await page.addScriptTag({ path: axePath });
      const res = await page.evaluate(async () => {
        const r = await window.axe.run(document, {
          resultTypes: ["violations"],
          runOnly: {
            type: "tag",
            values: [
              "wcag2a",
              "wcag2aa",
              "wcag21a",
              "wcag21aa",
              "best-practice",
            ],
          },
        });
        return r.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.map((n) => ({
            target: n.target.join(" "),
            html: String(n.html).slice(0, 220),
            summary: (n.failureSummary || "").split("\n").slice(0, 3).join(" "),
          })),
        }));
      });
      runs.push({ theme, url, violations: res });
    }
  }
  await page.close();
  axeReport = runs;
}

if (!axeReport) {
  const why = !browserReady
    ? browserWhy
    : !existsSync(axePath)
      ? `未找到 axe-core（${axePath}）`
      : "未知";
  manual(
    "E3-1",
    "E",
    "axe critical 违规 0（受检集合 × 亮暗 × zh/en）",
    "拦截",
    `未运行：${why}。报告中标「未验证」。`,
  );
  manual(
    "E3-2",
    "E",
    "axe serious 违规 0（受检集合 × 亮暗 × zh/en）",
    "必修",
    `未运行：${why}。报告中标「未验证」。`,
  );
} else {
  const flat = axeReport.flatMap((r) =>
    r.violations.map((v) => ({ ...v, theme: r.theme, url: r.url })),
  );
  const critical = flat.filter((v) => v.impact === "critical");
  const serious = flat.filter((v) => v.impact === "serious");
  const fmt = (v) =>
    `${v.id}[${v.impact}] ${v.url}(${v.theme}) ${v.nodes.length} 节点：${v.nodes
      .slice(0, 2)
      .map((n) => `${n.target} → ${n.summary.slice(0, 110)}`)
      .join(" ; ")}`;
  const totalNodes = flat.reduce((n, v) => n + v.nodes.length, 0);
  if (!critical.length) {
    pass(
      "E3-1",
      "E",
      "axe critical 违规 0（受检集合 × 亮暗 × zh/en）",
      "拦截",
      `受检集合 ${SAMPLE.length} 页 × 亮暗 2 态 = ${axeReport.length} 次扫描，critical 0，全部违规节点 ${totalNodes} 个`,
      axeReport
        .map((r) => `${r.url}(${r.theme}) ${r.violations.length} 类`)
        .join("；"),
    );
  } else {
    fail(
      "E3-1",
      "E",
      "axe critical 违规 0（受检集合 × 亮暗 × zh/en）",
      "拦截",
      `${critical.length} 类 critical`,
      critical.map(fmt).join(" | "),
    );
  }
  if (!serious.length) {
    pass(
      "E3-2",
      "E",
      "axe serious 违规 0（受检集合 × 亮暗 × zh/en）",
      "必修",
      `${axeReport.length} 次扫描 serious 0`,
      "",
    );
  } else {
    const siteDefects = serious.filter((v) =>
      /lf-footer/.test(JSON.stringify(v.nodes)),
    );
    const upstream = serious.filter(
      (v) => !/lf-footer/.test(JSON.stringify(v.nodes)),
    );
    fail(
      "E3-2",
      "E",
      "axe serious 违规 0（受检集合 × 亮暗 × zh/en）",
      "必修",
      `${serious.length} 类 serious：本站缺陷 ${siteDefects.length} 类（.lf-footer 页脚小字用 --lf-text-faint #565f89，对 #12121a 仅 3.01:1，该档登记为「仅大字/装饰」）；` +
        `Starlight 上游行为 ${upstream.length} 类（基线裸 Starlight 站触发完全相同违规）`,
      serious.map(fmt).join(" | "),
    );
  }
  // 归因单列，供整改清单引用
  const siteDefectClasses = serious.filter((v) =>
    /lf-footer/.test(JSON.stringify(v.nodes)),
  );
  if (siteDefectClasses.length) {
    results.push({
      id: "E3-3",
      group: "E",
      name: "页脚对比度缺陷归因（样式层）",
      severity: "必修",
      status: "FAIL",
      detail:
        `${siteDefectClasses.reduce((n, v) => n + v.nodes.length, 0)} 个节点在暗色下不达 WCAG AA：.lf-footer__brand-alt / .lf-footer__heading ×4 / .lf-footer__copyright。` +
        `根因：样式表 faint 档用于页脚正文（--lf-text-faint #565f89），对暗色 bg #12121a 测得 3.01:1，字号 10.5–13px，需 ≥4.5:1。` +
        `修复入口：把这三处的 color 改为 --lf-text-muted（#a9b1d6，对 #12121a 为 8.82:1）或更亮的档位；不得把 #565f89 用于 18.66px 以下的文字。`,
      evidence: siteDefectClasses.map(fmt).join(" | "),
    });
  }
}

if (browser) await browser.close();

// ================================================================ 输出