/**
 * 诊断文案分层测试（**边界条件** + **回归锚定**）。
 *
 * 核心：把「状态」与「怎么处置」拆开。实测原message 在 320px 窄栏里
 * 每条竖排 5~6 行（`avgItemH=120px`）—— 因为括号里的说明（往往写着
 * 「本条可忽略」）占了主句 3/4 篇幅。
 *
 * ⚠️ 不改 `Diagnostic.message` 的形状（契约不动）—— 拆的是渲染分层。
 */
import { describe, expect, it } from "vitest";
import { diagnosticBrief, splitDiagnosticMessage } from "../../packages/editor/src/diagnostics/message";

describe("文案分层：主句只说状态", () => {
  it("**回归锚定**：unused-translation 的长说明被切走（实测占 3/4 篇幅）", () => {
    const message =
      "未使用的译文键：🤝 第三章 · 相遇（say / menu / input / notify 四个翻译面均未命中原文——该键运行期不会生效；若这段文字只用于元素文本或宿主界面，本条可忽略）";
    const parts = splitDiagnosticMessage(message);
    expect(parts.brief).toBe("未使用的译文键：🤝 第三章 · 相遇");
    expect(parts.detail).toContain("四个翻译面均未命中原文");
    // 🔴 核心判据：主句显著变短（这是扫读成本的关键）
    expect(parts.brief.length).toBeLessThan(parts.detail.length);
  });

  it("插值型 undefined-variable 同样被切开", () => {
    const message =
      "未定义变量：who（插值失败将按原文保留——若它应是变量请先定义，若只是普通文字请去掉花括号）";
    const parts = splitDiagnosticMessage(message);
    expect(parts.brief).toBe("未定义变量：who");
    expect(parts.detail).toContain("插值失败将按原文保留");
  });

  it("四类诊断全都能切开（不只unused 一类）", () => {
    const messages = [
      "未定义变量：x（表达式里使用，求值会失败并**停机**——请先用 set/define 定义它）",
      "未使用的译文键：a（四个翻译面均未命中原文——本条可忽略）",
      "原文未有任何译文：b（所有语言的 overlay 均未命中——运行期回退原文；专有名词等有意保留原文的可忽略）",
    ];
    for (const m of messages) {
      const p = splitDiagnosticMessage(m);
      expect(p.detail, `未切开：${m}`).not.toBe("");
      expect(p.brief.includes("（")).toBe(false);
    }
  });
});

describe("边界条件", () => {
  it("**无括号的短文案** ⇒ 整句是主句、无说明（不硬造空括号）", () => {
    const parts = splitDiagnosticMessage("资源路径不存在：Images/x.png");
    expect(parts.brief).toBe("资源路径不存在：Images/x.png");
    expect(parts.detail).toBe("");
  });

  it("空串⇒ 空主句 + 空说明", () => {
    expect(splitDiagnosticMessage("")).toEqual({ brief: "", detail: "" });
  });

  it("**左括号在开头** ⇒ 不当说明（否则主句为空）", () => {
    const parts = splitDiagnosticMessage("（说明在前）主句在后");
    expect(parts.brief).toBe("（说明在前）主句在后");
    expect(parts.detail).toBe("");
  });

  it("**括号未闭合** ⇒ 整句算主句（宁可长也不丢信息）", () => {
    const parts = splitDiagnosticMessage("未定义变量：x（没闭合的说明");
    expect(parts.brief).toBe("未定义变量：x（没闭合的说明");
    expect(parts.detail).toBe("");
  });

  it("**嵌套括号 ⇒ 切到配对的右括号**（不切一半）", () => {
    const parts = splitDiagnosticMessage("主句（外层（内层）还有）尾巴");
    expect(parts.brief).toBe("主句");
    expect(parts.detail).toBe("外层（内层）还有");
  });

  it("多个括号段：只切首个，配对右括号后的内容归入说明", () => {
    const parts = splitDiagnosticMessage("主句（说明1）中间（说明2）");
    expect(parts.brief).toBe("主句");
    expect(parts.detail).toContain("说明1");
  });

  it("brief 去掉尾部空白（切完不该留悬空空格）", () => {
    const parts = splitDiagnosticMessage("主句   （说明）");
    expect(parts.brief).toBe("主句");
    expect(parts.brief.endsWith(" ")).toBe(false);
  });
});

describe("便捷出口", () => {
  it("diagnosticBrief = 主句", () => {
    expect(diagnosticBrief("a（b）")).toBe("a");
    expect(diagnosticBrief("a")).toBe("a");
  });

  it("**信息不丢**：brief + detail 合起来覆盖原文（除括号本身）", () => {
    const message = "主句（说明内容）";
    const p = splitDiagnosticMessage(message);
    expect(`${p.brief}（${p.detail}）`).toBe(message);
  });
});
