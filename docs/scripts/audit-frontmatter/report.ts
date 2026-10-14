/**
 * audit-frontmatter · 结果输出与退出码
 */
import { DIST, results, rows } from "./shared.ts";

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
        script: "audit-frontmatter",
        baseline: DIST,
        pageCount: rows.length,
        zh: rows.filter((r) => !r.en).length,
        en: rows.filter((r) => r.en).length,
        results,
        blockers: blockers.length,
      },
      null,
      2,
    ),
  );
} else {
  const icon = { PASS: "✓", FAIL: "✗", MANUAL: "?" };
  console.log("\n=== audit-frontmatter · 逐页 head 与文档结构（A / E / H）===");
  console.log(`产物：${DIST}`);
  console.log(
    `页数：${rows.length}（zh ${rows.filter((r) => !r.en).length} / en ${rows.filter((r) => r.en).length}）\n`,
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
