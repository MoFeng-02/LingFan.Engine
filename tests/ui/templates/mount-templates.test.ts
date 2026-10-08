/**
 * 挂载点模板测试（选择层 / 通知层 / 通用注册表）。
 *
 * 与对话模板同口径：按名解析 / 未知名回退默认 / 空名哨兵不可占用；
 * 与元素·小游戏注册表的关键差异：**模板缺失回退默认（fail-soft）**——
 * 模板只影响展示，不伪造语义。
 * 故意错误：恶意 HTML 注入（两挂载点都经统一接缝转义）。
 */
import { describe, expect, it } from "vitest";
import type { ChoiceTemplateFn, NotifyTemplateFn } from "@lingfan/ui";
import {
  builtinChoiceTemplate,
  builtinNotifyTemplate,
  createChoiceTemplateRegistry,
  createNotifyTemplateRegistry,
  createTemplateRegistry,
  renderDialogueLine,
  toNotifyTone,
} from "@lingfan/ui";

describe("通用模板注册表（TemplateRegistry）", () => {
  type In = { text: string };
  type View = { rootClass: string; bodyHtml: string };

  const fn = (root: string): ((i: In) => View) => (i) => ({
    rootClass: root,
    bodyHtml: i.text,
  });

  it("按名解析；未知名/null/空串回退默认；未设默认 = null（宿主兜底）", () => {
    const r = createTemplateRegistry<In, View>();
    expect(r.resolve("ghost")).toBeNull();
    expect(r.resolve(null)).toBeNull();
    const def = fn("def");
    r.register("def", def, { makeDefault: true });
    expect(r.resolve("ghost")).toBe(def); // 未知名回退默认（fail-soft）
    expect(r.resolve(null)).toBe(def);
    expect(r.resolve("")).toBe(def);
  });

  it("makeDefault 切换默认；同名覆盖不抢默认；空名不可注册", () => {
    const r = createTemplateRegistry<In, View>();
    const a = fn("a");
    const b = fn("b");
    r.register("a", a, { makeDefault: true });
    r.register("b", b, { makeDefault: true });
    expect(r.resolve(null)).toBe(b);
    const a2 = fn("a2");
    r.register("a", a2);
    expect(r.resolve("a")).toBe(a2);
    expect(r.resolve(null)).toBe(b);
    r.register("", fn(""));
    expect(r.has("")).toBe(false);
  });

  it("names 反映已注册集合（诊断用；不含空名）", () => {
    const r = createTemplateRegistry<In, View>();
    r.register("x", fn("x"));
    r.register("y", fn("y"));
    r.register("", fn("z"));
    expect(r.names().sort()).toEqual(["x", "y"]);
  });
});

describe("选择层模板（choices）", () => {
  const input = {
    prompt: "接下来去哪里？",
    options: [
      { text: "酒馆", target: "inn" },
      { text: "广场", target: "square" },
    ],
  };

  it("内置默认模板：提示行 + 逐项转义文本，与选项等长同序", () => {
    const view = builtinChoiceTemplate(input);
    expect(view.rootClass).toBe("tpl-choice");
    expect(view.promptHtml).toContain("接下来去哪里？");
    expect(view.optionHtml).toHaveLength(2);
    expect(view.optionHtml[0]).toContain("酒馆");
    expect(view.optionHtml[1]).toContain("广场");
  });

  it("无提示 → 提示行为空串（宿主据此隐藏该行）", () => {
    const view = builtinChoiceTemplate({ ...input, prompt: "" });
    expect(view.promptHtml).toBe("");
  });

  it("注册表：自定义模板按名解析，未知名回退默认", () => {
    const r = createChoiceTemplateRegistry();
    r.register("default", builtinChoiceTemplate, { makeDefault: true });
    const numbered: ChoiceTemplateFn = (i) => ({
      rootClass: "numbered",
      promptHtml: "",
      optionHtml: i.options.map((o, idx) => `${idx + 1}. ${o.text}`),
    });
    r.register("numbered", numbered);
    expect(r.resolve("numbered")).toBe(numbered);
    expect(r.resolve("ghost")).toBe(builtinChoiceTemplate);
  });

  it("选项文本恶意 HTML 被统一接缝转义（XSS 防线——故意错误）", () => {
    const view = builtinChoiceTemplate({
      prompt: '<script>alert(1)</script>',
      options: [{ text: '<img src=x onerror="alert(1)">', target: "t" }],
    });
    expect(view.promptHtml).not.toContain("<script");
    expect(view.promptHtml).toContain("&lt;script");
    expect(view.optionHtml[0]).not.toContain("<img");
    expect(view.optionHtml[0]).toContain("&lt;img");
  });

  it("空选项列表 → 空数组（宿主不渲染任何选项；不伪造占位）", () => {
    const view = builtinChoiceTemplate({ prompt: "p", options: [] });
    expect(view.optionHtml).toEqual([]);
  });

  it("选项数量与顺序严格保持（宿主按序挂点击，错位即点错目标）", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      text: `选项${i}`,
      target: `t${i}`,
    }));
    const view = builtinChoiceTemplate({ prompt: "", options: many });
    expect(view.optionHtml).toHaveLength(6);
    view.optionHtml.forEach((html, i) => expect(html).toContain(`选项${i}`));
  });

  it("与统一渲染接缝同源（同文本同产物，宿主可换模板而不换转义口径）", () => {
    const view = builtinChoiceTemplate({
      prompt: "",
      options: [{ text: "{b}加粗{/b}", target: "t" }],
    });
    expect(view.optionHtml[0]).toBe(
      renderDialogueLine({ text: "{b}加粗{/b}" }).html,
    );
  });
});

describe("通知层模板（notify）", () => {
  it("内置默认模板：正文转义 + 按 tone 加皮肤类", () => {
    const info = builtinNotifyTemplate({ text: "已保存", tone: "info" });
    expect(info.rootClass).toContain("tpl-notify");
    expect(info.rootClass).toContain("info");
    expect(info.bodyHtml).toContain("已保存");
    expect(
      builtinNotifyTemplate({ text: "x", tone: "error" }).rootClass,
    ).toContain("error");
  });

  it("tone 归一：未知/缺省 → info（不静默丢信息）", () => {
    expect(toNotifyTone("warning")).toBe("warning");
    expect(toNotifyTone("error")).toBe("error");
    expect(toNotifyTone("info")).toBe("info");
    expect(toNotifyTone(undefined)).toBe("info");
    expect(toNotifyTone("whatever")).toBe("info");
    expect(toNotifyTone(42)).toBe("info");
  });

  it("注册表：未知名回退默认（fail-soft，与元素/小游戏注册表口径不同）", () => {
    const r = createNotifyTemplateRegistry();
    r.register("default", builtinNotifyTemplate, { makeDefault: true });
    expect(r.resolve("ghost")).toBe(builtinNotifyTemplate);
    expect(r.resolve(null)).toBe(builtinNotifyTemplate);
    // 未注册任何默认时 = null（宿主必须自带兜底实现）
    const empty = createNotifyTemplateRegistry();
    expect(empty.resolve("ghost")).toBeNull();
  });

  it("通知文本恶意 HTML 被统一接缝转义（XSS 防线——故意错误）", () => {
    const view = builtinNotifyTemplate({
      text: '<img src=x onerror="alert(1)">',
      tone: "info",
    });
    expect(view.bodyHtml).not.toContain("<img");
    expect(view.bodyHtml).toContain("&lt;img");
  });

  it("自定义模板可换装但不改文案口径（同输入同文本）", () => {
    const fancy: NotifyTemplateFn = (i) => ({
      rootClass: `fancy-${i.tone}`,
      bodyHtml: `★ ${renderDialogueLine({ text: i.text }).html}`,
    });
    const view = fancy({ text: "提示", tone: "warning" });
    expect(view.rootClass).toBe("fancy-warning");
    expect(view.bodyHtml).toContain("★");
    expect(view.bodyHtml).toContain("提示");
  });
});
