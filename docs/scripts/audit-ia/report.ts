/**
 * audit-ia · 结果输出与退出码
 */
import { DIST, PREVIEW, groups, pages, results, zhPages } from "./shared.ts";
import { live } from "./checks-browser.ts";

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
        script: "audit-ia",
        baseline: DIST,
        preview: PREVIEW,
        pageCount: pages.length,
        sidebar: groups.map((g) => ({
          label: g.label,
          open: g.open,
          ownLinks: g.links.length,
          subGroups: g.children.map((c) => ({
            label: c.label,
            links: c.links.length,
          })),
        })),
        results,
        blockers: blockers.length,
      },
      null,
      2,
    ),
  );
} else {
  const icon = { PASS: "✓", FAIL: "✗", MANUAL: "?" };
  console.log("\n=== audit-ia · 信息架构与响应式（A / F）===");
  console.log(`产物：${DIST}`);
  console.log(
    `页数：${pages.length}（zh ${zhPages.length} / en ${pages.length - zhPages.length}）`,
  );
  console.log(`预览：${PREVIEW}${live ? "" : "（未响应）"}\n`);
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
