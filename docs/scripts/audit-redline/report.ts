/**
 * 结果输出与退出码
 */

import { DIST, pages, results } from "./shared.ts";
import { STARLIGHT_DEFAULTS } from "./checks-brand.ts";

const JSON_OUT = process.argv.includes("--json");

const order = { 拦截: 0, 必修: 1, 建议: 2 };
results.sort(
  (a, b) => order[a.severity] - order[b.severity] || a.id.localeCompare(b.id),
);
const blockers = results.filter(
  (r) => r.severity === "拦截" && r.status === "FAIL",
);

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        script: "audit-redline",
        baseline: DIST,
        pageCount: pages.length,
        starlightDefaults: STARLIGHT_DEFAULTS,
        results,
        blockers: blockers.length,
      },
      null,
      2,
    ),
  );
} else {
  const icon = { PASS: "✓", FAIL: "✗", MANUAL: "?" };
  console.log(
    "\n=== audit-redline · 内容规范 / 令牌 / 版式一致性 / axe（C / G / H / E）===",
  );
  console.log(`产物：${DIST}`);
  console.log(
    `页数：${pages.length}（zh ${pages.filter((p) => !p.en).length} / en ${pages.filter((p) => p.en).length}）`,
  );
  console.log(
    `Starlight 默认品牌色 hex 等价表（实算）：${STARLIGHT_DEFAULTS.map((d) => `${d.theme} ${d.hex}`).join(" / ")}\n`,
  );
  for (const r of results) {
    console.log(`${icon[r.status]} [${r.severity}] ${r.id} ${r.name}`);
    console.log(`    ${r.detail}`);
    if (r.evidence) console.log(`    证据：${r.evidence}`);
  }
  const cnt = (s, st) =>
    results.filter((r) => r.severity === s && r.status === st).length;
  console.log("\n--- 汇总 ---");
  for (const s of ["拦截", "必修", "建议"])
    console.log(
      `${s}：通过 ${cnt(s, "PASS")} / 失败 ${cnt(s, "FAIL")} / 待人工 ${cnt(s, "MANUAL")}`,
    );
  console.log(`\n拦截级失败：${blockers.length}`);
}
process.exit(blockers.length === 0 ? 0 : 1);
