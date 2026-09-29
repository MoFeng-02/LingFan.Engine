/**
 * 规约 10 编辑器 schema 动态注册测试（T08-04）。
 * 锚点: editor-dynamic-op-schema
 *
 * 测试纪律：
 * - **纯函数合并不改本体**：mergeOpSchemas/mergeOpMeta 产出扩展集，OP_SCHEMAS/OP_META 常量
 *   本体零修改（快照前后键集合相等）
 * - **注册后表单可用 + 不假红**：合并面上 describeForm 出表单、validateCommand/validateStory
 *   零诊断；**未注册口径不变**——内建面上同命令仍 unknown-op（与引擎一致）
 * - **装配期 fail-fast**：归组不在八组内 = 扩展声明违约 → mergeOpMeta 抛错带定位
 * - **互锁扩展**：「引擎 op 面 ⊆ 编辑器 op 面」——动态注册的 op 也纳入（buildOpRegistry 键集合
 *   ⊆ 合并 schema 键集合）；内建 BUILTIN_OP_NAMES ⊆ OP_SCHEMAS 键集合
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BUILTIN_OP_SURFACE,
  describeForm,
  listOpGroups,
  mergeOpMeta,
  mergeOpSchemas,
  mergeOpSurface,
  OP_SCHEMAS,
  validateCommand,
  validateStory,
} from "@lingfan/editor";
import {
  BUILTIN_OP_NAMES,
  buildOpRegistry,
  type OpExtension,
} from "@lingfan/engine";

const diceSchema = z.strictObject({ sides: z.number().int().min(2) });

const diceExtension: OpExtension = {
  id: "dice",
  stateVersion: 1,
  ops: [
    {
      op: "roll_dice",
      exec: () => ({ ok: true }),
      schema: { label: "掷骰子", group: "variables", schema: diceSchema },
    },
  ],
};

const merged = mergeOpSurface([diceExtension]);

describe("T08-04 编辑器 schema 动态注册（锚点: editor-dynamic-op-schema）", () => {
  it("纯函数合并：产出扩展集，OP_SCHEMAS/OP_META 常量本体零修改", () => {
    const before = Object.keys(OP_SCHEMAS);
    const schemas = mergeOpSchemas(OP_SCHEMAS, [diceExtension]);
    expect(Object.keys(OP_SCHEMAS)).toEqual(before); // 本体未动
    expect(schemas).not.toBe(OP_SCHEMAS); // 新对象（扩展集）
    expect(schemas.roll_dice).toBe(diceSchema);
    expect(schemas.say).toBe(OP_SCHEMAS.say); // 内建条目原样透传

    const metaBefore = mergeOpMeta(BUILTIN_OP_SURFACE.meta, []);
    expect(metaBefore).toEqual(BUILTIN_OP_SURFACE.meta);
    const meta = mergeOpMeta(BUILTIN_OP_SURFACE.meta, [diceExtension]);
    expect(meta).toHaveLength(BUILTIN_OP_SURFACE.meta.length + 1);
    expect(meta.at(-1)).toEqual({
      op: "roll_dice",
      label: "掷骰子",
      group: "variables",
    });
  });

  it("注册后表单可用：describeForm 出标签/归组/字段（zod shape 派生）", () => {
    const form = describeForm("roll_dice", merged);
    expect(form).not.toBeUndefined();
    expect(form?.label).toBe("掷骰子");
    expect(form?.group).toBe("variables");
    expect(form?.fields).toEqual([
      {
        key: "sides",
        label: "sides", // 扩展未声明 FIELD_META → 回退字段名（文档化行为）
        kind: "number", // zod 派生兜底（meta 恒优先，内建 op 不受影响）
        required: true,
        hasDefault: false,
      },
    ]);
    expect(describeForm("roll_dice")).toBeUndefined(); // 内建面：未注册 = unknown-op 口径
  });

  it("校验：合并面上合法命令零诊断 / 缺必填报 invalid-structure；内建面仍 unknown-op", () => {
    const cmd = { op: "roll_dice", sides: 6 };
    expect(validateCommand(cmd, "/x", merged.schemas)).toEqual([]);
    const bad = validateCommand({ op: "roll_dice" }, "/x", merged.schemas);
    expect(bad).toHaveLength(1);
    expect(bad[0]?.code).toBe("missing-required");
    expect(validateCommand(cmd)).toHaveLength(1); // 内建面：unknown-op（口径不变）
    expect(validateCommand(cmd)[0]?.code).toBe("unknown-op");
  });

  it("validateStory：带扩展零诊断 / 缺扩展 unknown-op（不假红）", () => {
    const story = {
      formatVersion: 1,
      id: "t",
      entry: "a",
      columns: [{ id: "a", kind: "flow", commands: [{ op: "roll_dice", sides: 6 }] }],
    };
    expect(validateStory(structuredClone(story), [diceExtension])).toEqual([]);
    const without = validateStory(structuredClone(story));
    expect(without).toHaveLength(1);
    expect(without[0]?.code).toBe("unknown-op");
    expect(without[0]?.pointer).toBe("/columns/0/commands/0");
  });

  it("归组不在八组内 → 装配期 fail-fast 抛错（带扩展 id 与 op 名定位）", () => {
    const badExt: OpExtension = {
      id: "bad",
      stateVersion: 1,
      ops: [
        {
          op: "bad_op",
          exec: () => ({ ok: true }),
          schema: { label: "坏归组", group: "not-a-group" as never, schema: diceSchema },
        },
      ],
    };
    expect(() => mergeOpMeta(BUILTIN_OP_SURFACE.meta, [badExt])).toThrow(
      /扩展「bad」的 op「bad_op」归组不合法/,
    );
    expect(() => mergeOpSurface([badExt])).toThrow(/归组不合法/);
  });

  it("互锁：引擎 op 面（内建 + 动态注册）⊆ 编辑器 op 面", () => {
    // 内建半边：BUILTIN_OP_NAMES 全部在编辑器 schema 面（既有 schema.test.ts 另以 format.ts
    // 源提取做更强互锁；此处以注册表口径补动态维度）
    for (const op of BUILTIN_OP_NAMES) {
      expect(OP_SCHEMAS[op], `内建 op ${op} 应有编辑器 schema`).not.toBeUndefined();
    }
    // 动态半边：经引擎注册表校验的扩展 op 必须出现在合并面
    const registry = buildOpRegistry([diceExtension]);
    for (const op of registry.keys()) {
      expect(merged.schemas[op], `扩展 op ${op} 应入合并面`).not.toBeUndefined();
    }
    expect(registry.has("roll_dice")).toBe(true);
  });

  it("组件面板：合并面上扩展 op 落入声明归组", () => {
    const groups = listOpGroups(merged);
    const variables = groups.find((g) => g.group === "variables");
    expect(
      variables?.ops.some((entry) => entry.op === "roll_dice"),
    ).toBe(true);
    // 内建面不含扩展 op（口径不变）
    const builtin = listOpGroups();
    expect(
      builtin.every((g) => g.ops.every((entry) => entry.op !== "roll_dice")),
    ).toBe(true);
  });
});
