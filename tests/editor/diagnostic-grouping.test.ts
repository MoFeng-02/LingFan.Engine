/**
 * 诊断面板 · 分组与折叠判据测试（**边界条件** + **不变量** + **回归**）。
 *
 * 重点覆盖「同质诊断淹没异质诊断」这个真问题：实测演示工程 33 条诊断里
 * 31 条是 `unused-translation`，把 2 条真错误埋掉了 —— 分组判据必须保证
 * ① 错误组永远在最上 ② 同严重度按条数降序 ③ 折叠**不藏错误**。
 */
import { describe, expect, it } from "vitest";
import {
  diagnosticCodeLabel,
  diagnosticSummaryText,
  filterDiagnosticsBySeverity,
  groupDiagnostics,
  summarizeDiagnostics,
} from "../../packages/editor/src/diagnostics/grouping";
import type { Diagnostic } from "../../packages/editor/src/contracts/diagnostics";

function d(
  code: string,
  severity: "error" | "warning",
  pointer = "",
  message = "m",
): Diagnostic {
  return { code, severity, pointer, message };
}

describe("分组：严重度优先（**错误不被警告淹没**）", () => {
  it("**回归**：31 条 warning + 2 条 error ⇒ error 组排最前", () => {
    const list: Diagnostic[] = [
      ...Array.from({ length: 31 }, (_, i) =>
        d("unused-translation", "warning", "", `未使用 ${i}`),
      ),
      d("undefined-variable", "warning", "/columns/0/commands/0/text"),
      d("undefined-variable", "error", "/columns/1/commands/2/cond"),
    ];
    const groups = groupDiagnostics(list);
    expect(groups).toHaveLength(2);
    // 核心判据：真错误那组在第一位
    expect(groups[0]?.severity).toBe("error");
    expect(groups[0]?.code).toBe("undefined-variable");
    // 且它含全部 2 条（error 组取组内最高严重度）
    expect(groups[0]?.items).toHaveLength(2);
    expect(groups[1]?.code).toBe("unused-translation");
    expect(groups[1]?.items).toHaveLength(31);
  });

  it("**同组混档 ⇒ 组严重度取最高**（warning 堆里的 error 不能被当成警告）", () => {
    const groups = groupDiagnostics([
      d("missing-target", "warning", "/a"),
      d("missing-target", "error", "/b"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.severity).toBe("error");
  });
});

describe("分组：排序确定性（**不随输入顺序抖**）", () => {
  it("同严重度 ⇒ 按条数降序（最成灾的类型最显眼）", () => {
    const groups = groupDiagnostics([
      d("a-code", "warning", "/1"),
      d("b-code", "warning", "/1"),
      d("b-code", "warning", "/2"),
      d("b-code", "warning", "/3"),
    ]);
    expect(groups.map((g) => g.code)).toEqual(["b-code", "a-code"]);
  });

  it("同严重度同条数 ⇒ 按 code 码元序（确定性输出）", () => {
    const groups = groupDiagnostics([
      d("zeta", "warning", "/1"),
      d("alpha", "warning", "/1"),
    ]);
    expect(groups.map((g) => g.code)).toEqual(["alpha", "zeta"]);
  });

  it("**输入顺序不同 ⇒ 分组结果逐字节相同**（写回判等的前提是确定性）", () => {
    const a = [d("x", "warning", "/1"), d("y", "warning", "/1"), d("y", "warning", "/2")];
    const b = [...a].reverse();
    expect(JSON.stringify(groupDiagnostics(a))).toBe(
      JSON.stringify(groupDiagnostics(b)),
    );
  });

  it("**组内按 pointer 稳定排序**（确定性优先于「原始顺序」——那会让两次渲染出不同 DOM）", () => {
    const groups = groupDiagnostics([
      d("c", "warning", "/root/child/leaf"),
      d("c", "warning", "/root"),
      d("c", "warning", "/root/child"),
    ]);
    expect(groups[0]?.items.map((i) => i.pointer)).toEqual([
      "/root",
      "/root/child",
      "/root/child/leaf",
    ]);
  });

  it("**全局诊断（空 pointer）沉底**（可定位的排前面）", () => {
    const groups = groupDiagnostics([
      d("c", "warning", ""),
      d("c", "warning", "/z"),
    ]);
    expect(groups[0]?.items.map((i) => i.pointer)).toEqual(["/z", ""]);
  });
});

describe("折叠：error 组永不默认折叠（**藏错误 = 仪表盘失效**）", () => {
  it("error 组 ⇒ collapsedByDefault=false（哪怕 100 条）", () => {
    const groups = groupDiagnostics(
      Array.from({ length: 100 }, (_, i) => d("bad", "error", `/x${i}`)),
    );
    expect(groups[0]?.collapsedByDefault).toBe(false);
  });

  it("warning 组多条 ⇒ 建议折叠", () => {
    const groups = groupDiagnostics([
      d("w", "warning", "/1"),
      d("w", "warning", "/2"),
    ]);
    expect(groups[0]?.collapsedByDefault).toBe(true);
  });

  it("**warning 组单条 ⇒ 不建议折叠**（折了没意义，只多一次点击）", () => {
    const groups = groupDiagnostics([d("w", "warning", "/1")]);
    expect(groups[0]?.collapsedByDefault).toBe(false);
  });
});

describe("边界条件", () => {
  it("空诊断 ⇒ 空组（空态由视图表达，不塞占位组）", () => {
    expect(groupDiagnostics([])).toEqual([]);
  });

  it("单条诊断 ⇒ 单组", () => {
    const groups = groupDiagnostics([d("only", "error", "/p")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toHaveLength(1);
  });

  it("**未知 code ⇒ 原样回显**（不编造标签，也不隐藏）", () => {
    expect(diagnosticCodeLabel("brand-new-code")).toBe("brand-new-code");
    const groups = groupDiagnostics([d("brand-new-code", "error", "/p")]);
    expect(groups[0]?.label).toBe("brand-new-code");
  });

  it("已知 code ⇒ 中文标签", () => {
    expect(diagnosticCodeLabel("unused-translation")).toBe("未使用的译文键");
    expect(diagnosticCodeLabel("undefined-variable")).toBe("未定义变量");
  });
});

describe("汇总（**不逐条罗列**——那正是淹没的来源）", () => {
  it("计数正确（条数 / 类数 / 错误数 / 警告数）", () => {
    const groups = groupDiagnostics([
      d("a", "error", "/1"),
      d("b", "warning", "/1"),
      d("b", "warning", "/2"),
    ]);
    expect(summarizeDiagnostics(groups)).toEqual({
      total: 3,
      kinds: 2,
      errors: 1,
      warnings: 2,
    });
  });

  it("**零诊断 ⇒ 「无」而不是「0 条 · 0 类」**（那是空数据的算术，不是状态）", () => {
    expect(diagnosticSummaryText(summarizeDiagnostics([]))).toBe("无");
  });

  it("文案：只有错误时不说警告", () => {
    const groups = groupDiagnostics([d("a", "error", "/1")]);
    expect(diagnosticSummaryText(summarizeDiagnostics(groups))).toBe("1 条 · 1 个错误");
  });

  it("文案：两类都有时都列出", () => {
    const groups = groupDiagnostics([d("a", "error", "/1"), d("b", "warning", "/1")]);
    expect(diagnosticSummaryText(summarizeDiagnostics(groups))).toBe(
      "2 条 · 1 个错误 · 1 个警告",
    );
  });
});

describe("严重度筛选 filterDiagnosticsBySeverity（#9 徽章判据）", () => {
  const list: Diagnostic[] = [
    d("missing-target", "error", "/a"),
    d("unused-translation", "warning", ""),
    d("invalid-value", "error", "/b"),
    d("missing-translation", "warning", ""),
  ];

  it("null = 全部：**原样返回（同一引用）**——筛选不得重排/复制/改写", () => {
    expect(filterDiagnosticsBySeverity(list, null)).toBe(list);
  });

  it("error 筛选：只留 error，**相对顺序保持**（排序仍归 groupDiagnostics）", () => {
    const filtered = filterDiagnosticsBySeverity(list, "error");
    expect(filtered.map((x) => x.code)).toEqual(["missing-target", "invalid-value"]);
  });

  it("warning 筛选：只留 warning", () => {
    expect(filterDiagnosticsBySeverity(list, "warning")).toHaveLength(2);
    expect(filterDiagnosticsBySeverity(list, "warning").every((x) => x.severity === "warning")).toBe(
      true,
    );
  });

  it("**边界**：空输入 / 全是同档时筛另一档 ⇒ 空数组（不抛、不塞占位）", () => {
    expect(filterDiagnosticsBySeverity([], "error")).toEqual([]);
    expect(filterDiagnosticsBySeverity([d("a", "error", "/1")], "warning")).toEqual([]);
  });

  it("筛选不改诊断对象（同一引用子集，不是深拷贝赝品）", () => {
    const errorItem = list[0]!;
    expect(filterDiagnosticsBySeverity(list, "error")[0]).toBe(errorItem);
  });
});
