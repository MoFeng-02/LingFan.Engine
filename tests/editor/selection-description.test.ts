/**
 * 属性面板「选中态四态」测试 —— 回归守卫。
 *
 * 用户可见缺陷：选中 scene 列时属性面板显示「所选位置不是命令（**op 缺失**）——诊断面板
 * 有详情」，而**同一时刻**诊断面板显示「✓ 无诊断（编辑期校验通过）」⇒ 两处互相打脸，
 * 且把**正常操作**（选中一列）说成故障。
 *
 * 真实语义有四种，只有 `unknown-op` 才是真问题：
 * `none`（没选） / `non-command`（选中列·元素·数组项——**正常**） /
 * `unknown-op`（落在命令上但无表单描述符——**真问题**） / `command`（正常命令）。
 *
 * 测试要点五类：
 * - 真值表：五类指针 + 悬空 + 根，逐项断言 `kind` 与 `nodeKind`
 * - 故意错误：悬空指针（撤销后的陈旧选中）**不得**谎报成「op 缺失」——它归 `non-command`
 * - 边界：`null` / 根指针 `""` / 嵌套块体内的数组项
 * - **一致性互锁（防回流）**：`non-command` 与 `none` 的文案所在区块**禁出现
 *   「缺失 / 错误 / 诊断」**，且旧文案措辞必须彻底消失
 * - 接线互锁：组件确实调用了纯函数（不是各写一份判断）
 */
import { describe, expect, it } from "vitest";
import { parseStory } from "@lingfan/engine";
import { describeSelection } from "@lingfan/editor";
import propertyPanelSource from "../../apps/editor/src/components/PropertyPanel.vue?raw";

/** 0 = flow 列（首条 say + 一条 if[then 数组]）；1 = scene 列（一个 text 元素） */
function story() {
  return parseStory({
    formatVersion: 1,
    id: "t",
    entry: "start",
    columns: [
      {
        id: "start",
        kind: "flow",
        commands: [
          { op: "say", text: "句" },
          { op: "if", cond: "1", then: [{ op: "say", text: "内" }] },
        ],
      },
      {
        id: "stage",
        kind: "scene",
        elements: [{ type: "text", x: 0, y: 0, text: "t" }],
      },
    ],
  });
}

describe("真值表：四态互斥且各有其触发条件", () => {
  const s = story();

  it("none —— 没有选中任何位置", () => {
    expect(describeSelection(s, null)).toEqual({ kind: "none" });
  });

  it("non-command / column —— 选中一列（**正常操作，不是错误**）", () => {
    expect(describeSelection(s, "/columns/0")).toEqual({
      kind: "non-command",
      nodeKind: "column",
    });
    expect(describeSelection(s, "/columns/1")).toEqual({
      kind: "non-command",
      nodeKind: "column",
    });
  });

  it("non-command / element —— 选中一个元素", () => {
    expect(describeSelection(s, "/columns/1/elements/0")).toEqual({
      kind: "non-command",
      nodeKind: "element",
    });
  });

  it("non-command / item —— 选中组内的数组项（如 if.then）", () => {
    expect(describeSelection(s, "/columns/0/commands/1/then")).toEqual({
      kind: "non-command",
      nodeKind: "item",
    });
  });

  it("command —— 正常命令，带上 op 名供面板取表单", () => {
    expect(describeSelection(s, "/columns/0/commands/0")).toEqual({
      kind: "command",
      nodeKind: "item",
      opName: "say",
    });
  });

  it("unknown-op —— 落在命令上但无表单描述符（**这才是真问题**）", () => {
    // 未知 op 过不了 parseStory 校验 ⇒ 直接用最小合法形状的字面量（本函数只做指针读取）
    const withUnknown = {
      formatVersion: 1,
      id: "t",
      entry: "start",
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [{ op: "no-such-op-builtin" }],
        },
      ],
    };
    expect(describeSelection(withUnknown, "/columns/0/commands/0")).toEqual({
      kind: "unknown-op",
      nodeKind: "item",
      opName: "no-such-op-builtin",
    });
  });
});

describe("故意错误 / 边界：不得谎报，不得抛", () => {
  it("悬空指针（撤销后的陈旧选中）→ non-command，**不得**报成 op 缺失", () => {
    const result = describeSelection(story(), "/columns/99/commands/0");
    expect(result.kind).toBe("non-command");
    expect(result.kind).not.toBe("unknown-op");
  });

  it("根指针（空串）→ non-command / other", () => {
    expect(describeSelection(story(), "")).toEqual({
      kind: "non-command",
      nodeKind: "other",
    });
  });

  it("story 传非故事值（对抗输入）→ 不抛，退化为 non-command", () => {
    for (const bad of [null, 42, "x", []]) {
      expect(() => describeSelection(bad, "/columns/0")).not.toThrow();
      expect(describeSelection(bad, "/columns/0").kind).toBe("non-command");
    }
  });
});

describe("一致性互锁（防回流）：正常态文案不得说成故障", () => {
  /**
   * 剥离注释后再断言 —— 守卫的对象是**用户可见文案**，不是注释。
   * （本组件刻意在注释里引用了被撤掉的旧措辞以说明原因；不剥离会误判。）
   */
  function stripComments(source: string): string {
    return source
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  }
  const code = stripComments(propertyPanelSource);

  /** 中性文案所在区块（从 `neutralText` 到 `ancestors`） */
  const neutralBlock = code.slice(
    code.indexOf("const neutralText"),
    code.indexOf("const ancestors"),
  );

  it("中性区块存在且非空（否则下面的断言会假 PASS）", () => {
    expect(neutralBlock.length).toBeGreaterThan(50);
    expect(neutralBlock).toContain("neutralText");
  });

  it("`non-command` / `none` 文案区块禁出现「缺失 / 错误 / 诊断」", () => {
    for (const word of ["缺失", "错误", "诊断"]) {
      expect(neutralBlock).not.toContain(word);
    }
  });

  it("旧的误导文案已彻底消失（撤掉的字面不得回流到可见文案）", () => {
    expect(code).not.toContain("所选位置不是命令");
    expect(code).not.toContain("op 缺失");
  });

  it("模板按四态分派（四个 kind 字面量都在，防漏改某一态）", () => {
    for (const kind of ["none", "non-command", "unknown-op", "command"]) {
      expect(code).toContain(`'${kind}'`);
    }
  });

  it("接线互锁：面板调用纯函数，不自己再判一次", () => {
    expect(code).toContain("describeSelection(props.story, props.pointer)");
  });
});
