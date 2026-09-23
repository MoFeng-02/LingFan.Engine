/**
 * 08 §四.5 模板注册表测试（UI 层纯逻辑）。
 * 锚点：
 * - template-registry-resolve（按名解析/未知名与 null 回退默认/无默认 = null）
 * - template-registry-default（makeDefault 切换；同名覆盖不抢默认；空名哨兵不可占用）
 * - builtin-bubble（speaker 行/正文直通/推进指示器；speaker 经统一接缝转义——XSS 防线）
 * 故意错误：恶意 speaker HTML 注入、未知模板名解析。
 */
import { describe, expect, it } from "vitest";
import type { DialogueTemplateFn, DialogueTemplateInput } from "@lingfan/ui";
import {
  builtinBubbleTemplate,
  createDialogueTemplateRegistry,
  renderDialogueLine,
} from "@lingfan/ui";

const baseInput: DialogueTemplateInput = {
  speaker: "少女",
  speakerColor: "#ff0000",
  lineHtml: renderDialogueLine({ text: "你好" }).html,
  canAdvance: true,
};

function const_view(root: string): DialogueTemplateFn {
  return (i) => ({
    rootClass: root,
    speakerHtml: "",
    bodyHtml: i.lineHtml,
    hintHtml: "",
  });
}

describe("注册表解析（锚点: template-registry-resolve）", () => {
  it("按名解析注册模板", () => {
    const registry = createDialogueTemplateRegistry();
    const fn = const_view("x");
    registry.register("custom", fn);
    expect(registry.resolve("custom")).toBe(fn);
    expect(registry.has("custom")).toBe(true);
  });

  it("未知名/null/空串回退默认；未设默认 = null（宿主兜底）", () => {
    const registry = createDialogueTemplateRegistry();
    expect(registry.resolve("ghost")).toBeNull(); // 故意错误：未知模板名
    expect(registry.resolve(null)).toBeNull();
    const def = const_view("def");
    registry.register("def", def, { makeDefault: true });
    expect(registry.resolve("ghost")).toBe(def); // 老引擎 Resolve ?? GetDefault
    expect(registry.resolve(null)).toBe(def);
    expect(registry.resolve("")).toBe(def); // 空串 = 「无模板」哨兵 → 默认
  });

  it("makeDefault 切换默认；后注册同名覆盖但不抢默认", () => {
    const registry = createDialogueTemplateRegistry();
    const a = const_view("a");
    const b = const_view("b");
    registry.register("a", a, { makeDefault: true });
    registry.register("b", b, { makeDefault: true });
    expect(registry.resolve(null)).toBe(b);
    const a2 = const_view("a2");
    registry.register("a", a2);
    expect(registry.resolve("a")).toBe(a2);
    expect(registry.resolve(null)).toBe(b);
  });

  it("空名不可注册（「无模板」哨兵不被占用）", () => {
    const registry = createDialogueTemplateRegistry();
    registry.register("", const_view(""));
    expect(registry.has("")).toBe(false);
    expect(registry.resolve("")).toBeNull(); // 仍视为「无模板」
  });
});

describe("内置 bubble 模板（锚点: builtin-bubble）", () => {
  it("speaker 行 + 正文直通 + 推进指示器", () => {
    const view = builtinBubbleTemplate(baseInput);
    expect(view.rootClass).toBe("tpl-bubble");
    expect(view.bodyHtml).toBe(baseInput.lineHtml);
    expect(view.hintHtml).toBe("▼");
    expect(view.speakerHtml).toContain("少女");
  });

  it("无 speaker → 说话人行隐藏；不可推进 → 无指示器", () => {
    const view = builtinBubbleTemplate({
      ...baseInput,
      speaker: "",
      canAdvance: false,
    });
    expect(view.speakerHtml).toBe("");
    expect(view.hintHtml).toBe("");
  });

  it("speaker 恶意 HTML 注入被统一接缝转义（XSS 防线——故意错误）", () => {
    const view = builtinBubbleTemplate({
      ...baseInput,
      speaker: '<img src=x onerror="alert(1)">',
    });
    // 全量转义：不作为标签解释（< → &lt;、引号 → &quot;），注入以字面文本呈现
    expect(view.speakerHtml).not.toContain("<img");
    expect(view.speakerHtml).toContain("&lt;img");
    expect(view.speakerHtml).toContain("&quot;");
  });
});
