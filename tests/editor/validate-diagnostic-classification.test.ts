/**
 * 诊断分类守卫：区分「字段缺失」与「字段存在但类型错」。
 *
 * zod v4 对缺失字段以 undefined 输入报 invalid_type；字段存在但类型错时
 * input 是那个错值。分类判据：input === undefined ⇒ missing-required，
 * 否则 invalid-value。未知字段仍走 unknown-field；合法输入零诊断。
 */
import { describe, expect, it } from "vitest";
import { validateCommand } from "../../packages/editor/src/schema/opSchemas";

describe("诊断分类 · 字段缺失 vs 类型错", () => {
  it('类型错：wait seconds:"3" → invalid-value（字段存在）', () => {
    const diagnostics = validateCommand({ op: "wait", seconds: "3" });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("invalid-value");
    expect(diagnostics[0].pointer.endsWith("/seconds")).toBe(true);
  });

  it("缺必填：wait 缺 seconds → missing-required", () => {
    const diagnostics = validateCommand({ op: "wait" });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("missing-required");
  });

  it("null 不是缺失：wait seconds:null → invalid-value", () => {
    const diagnostics = validateCommand({ op: "wait", seconds: null });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("invalid-value");
  });

  it("NaN 回归：wait seconds:NaN → invalid-value", () => {
    const diagnostics = validateCommand({ op: "wait", seconds: NaN });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("invalid-value");
  });

  it("显式 undefined 视为缺失：wait seconds:undefined → missing-required", () => {
    const diagnostics = validateCommand({ op: "wait", seconds: undefined });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("missing-required");
  });

  it("类型错：say text:42 → invalid-value", () => {
    const diagnostics = validateCommand({ op: "say", text: 42 });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("invalid-value");
  });

  it("缺必填：say 缺 text → missing-required", () => {
    const diagnostics = validateCommand({ op: "say" });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("missing-required");
  });

  it("合法输入零诊断：wait seconds:1 → []", () => {
    expect(validateCommand({ op: "wait", seconds: 1 })).toEqual([]);
  });

  it("未知字段仍走 unknown-field（分类不受影响）", () => {
    const diagnostics = validateCommand({ op: "wait", seconds: 1, extra: 1 });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("unknown-field");
  });

  it("诊断对象键集恰为 code/severity/message/pointer/op（不新增字段）", () => {
    const diagnostics = validateCommand({ op: "wait", seconds: "3" });
    expect(Object.keys(diagnostics[0]).sort()).toEqual([
      "code",
      "message",
      "op",
      "pointer",
      "severity",
    ]);
  });
});
