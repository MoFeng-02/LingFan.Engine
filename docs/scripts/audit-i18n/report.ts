/**
 * audit-i18n · 结果输出与退出码
 */
import { DIST, enPages, results, rows, zhPages } from "./shared.ts";

const JSON_OUT = process.argv.includes("--json");

// ---------------------------------------------------------------- 输出
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
        script: "audit-i18n",
        baseline: DIST,
        pageCount: rows.length,
        zh: zhPages.length,
        en: enPages.length,
        enFallback: enPages.filter((r) => r.isFallback).length,
        enTranslated: enPages.filter((r) => !r.isFallback).length,
        results,
        blockers: blockers.length,
      },
      null,
      2,
    ),
  );
} else {
  const icon = { PASS: "✓", FAIL: "✗", MANUAL: "?" };
  console.log("\n=== audit-i18n · 双语站 i18n 检查===");
  console.log(`产物：${DIST}`);
  console.log(
    `页数：${rows.length}（zh ${zhPages.length} / en ${enPages.length}；en 侧 fallback ${enPages.filter((r) => r.isFallback).length} / 真译文 ${enPages.filter((r) => !r.isFallback).length}）\n`,
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
