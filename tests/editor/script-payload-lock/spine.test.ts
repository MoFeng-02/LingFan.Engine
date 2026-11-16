/**
 * 脊柱互锁：op 名集双向相等 / 出口同一性（同一函数对象）/
 * satisfies 施工完整性 / 完备性桥。
 *
 * editor 命令类型经转发链取自 core/script（单一声明）；本文件锁
 * 「转发链 ≡ core 出口」：名集双向相等、词函数同一对象（toBe）、
 * satisfies 计数与落点、生成物快照全量可赋给 core 名集。
 */
import { describe, expect, it } from "vitest";
import {
  OP_SCHEMAS,
  type CommandOf as EditorCommandOf,
  type ScriptOpName as EditorScriptOpName,
} from "../../../packages/editor/src/schema/opSchemas";
import * as editorScript from "../../../packages/editor/src/script";
import {
  VOCABULARY_OPS,
  type InputCandidateSpec,
  type MenuOptionSpec,
} from "../../../packages/editor/src/script";
import * as editorRoot from "@lingfan-engine/editor";
import * as coreScript from "@lingfan-engine/core/script";
import type {
  CommandOf as CoreCommandOf,
  InputCandidatePayload,
  MenuOptionPayload,
  ScriptOpName as CoreScriptOpName,
} from "@lingfan-engine/core/script";
import type { Assignable, SameKeys } from "./harness";

/** 已加 satisfies 锁的 schema 常量（与 commands.ts 施工面一一对应） */
const LOCKED_SCHEMAS = [
  "saySchema",
  "menuSchema",
  "inputSchema",
  "notifySchema",
  "nvlSchema",
  "characterSchema",
  "uncharacterSchema",
  "waitSchema",
  "pauseSchema",
  "randomSchema",
  "jumpSchema",
  "navigateSchema",
  "callSchema",
  "returnSchema",
  "funcSchema",
  "ifSchema",
  "whileSchema",
  "assertSchema",
  "guardSchema",
  "forSchema",
  "foreachSchema",
  "switchSchema",
  "emptySchema",
  "assignSchema",
  "undefSchema",
  "arraySchema",
  "arrayPushSchema",
  "arrayPopSchema",
  "dictSchema",
  "dictSetSchema",
  "saveSchema",
  "loadSchema",
  "autoSaveSchema",
  "saveDeleteSchema",
  "bgmSchema",
  "seSchema",
  "voiceSchema",
  "stopSchema",
  "audioPlaySchema",
  "audioStopSchema",
  "audioVolumeSchema",
  "audioPauseSchema",
  "audioResumeSchema",
  "videoSchema",
  "cutsceneSchema",
  "seekVideoSchema",
  "videoSkipableSchema",
  "minigameSchema",
  "interactionSchema",
  "showSchema",
  "hideSchema",
  "backgroundSchema",
  "bgSwitchSchema",
  "zindexSchema",
  "styleSchema",
  "windowSchema",
  "animateSchema",
  "animateBlockSchema",
  "transitionSchema",
  "shakeSchema",
  "textTypewriterSchema",
  "mountSchema",
] as const;

/** 出口同一性抽样：每域两词 + assign 四兄弟（词函数必须是同一对象） */
const IDENTITY_WORDS = [
  "say",
  "menu",
  "wait",
  "jump",
  "set",
  "define",
  "letVar",
  "localVar",
  "save",
  "load",
  "bgm",
  "audioPlay",
  "video",
  "cutscene",
  "show",
  "animate",
  "minigame",
  "interaction",
  "mount",
] as const;

/** 完备性桥：生成物快照的 op 字面量必须全量可赋给 core 名集（core 少一键即编译红） */
const _allOps: readonly CoreScriptOpName[] = VOCABULARY_OPS;
void _allOps;

const COMMANDS_SOURCE = import.meta.glob(
  "../../../packages/editor/src/schema/opSchemas/commands.ts",
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

describe("脊柱互锁 · satisfies 施工完整性", () => {
  it("计数守卫：commands.ts 的 satisfies 锁数量与已锁 schema 数一致", () => {
    const entries = Object.values(COMMANDS_SOURCE);
    expect(entries).toHaveLength(1);
    const source = entries[0];
    const count = source.split("satisfies z.ZodType<").length - 1;
    expect(LOCKED_SCHEMAS).toHaveLength(62);
    expect(count).toBe(LOCKED_SCHEMAS.length);
  });

  it("落点守卫：每个已锁 schema 的声明段内携带 satisfies", () => {
    const source = Object.values(COMMANDS_SOURCE)[0];
    const segments = source.split(/^const /m);
    for (const name of LOCKED_SCHEMAS) {
      const segment = segments.find((s) => s.startsWith(`${name} =`)) ?? "";
      expect(segment.includes("satisfies z.ZodType<"), name).toBe(true);
    }
  });
});

describe("脊柱互锁 · op 名集", () => {
  it("core ≡ editor 名集双向相等（转发后同源）", () => {
    const ce: Assignable<CoreScriptOpName, EditorScriptOpName> = true;
    const ec: Assignable<EditorScriptOpName, CoreScriptOpName> = true;
    void ce;
    void ec;
  });

  it("完备性桥 + 运行期键集：VOCABULARY_OPS ≡ OP_SCHEMAS ≡ 73", () => {
    expect(_allOps).toHaveLength(73);
    expect(new Set(VOCABULARY_OPS)).toEqual(new Set(Object.keys(OP_SCHEMAS)));
    expect(Object.keys(OP_SCHEMAS)).toHaveLength(73);
  });
});

describe("脊柱互锁 · 出口同一性（同一函数对象）", () => {
  it("词函数出口：editor script ≡ core script ≡ editor 根（toBe）", () => {
    for (const word of IDENTITY_WORDS) {
      const core = (coreScript as unknown as Record<string, unknown>)[word];
      expect(typeof core, word).toBe("function");
      expect(
        (editorScript as unknown as Record<string, unknown>)[word],
        word,
      ).toBe(core);
      expect(
        (editorRoot as unknown as Record<string, unknown>)[word],
        word,
      ).toBe(core);
    }
  });

  it("代表键的 CommandOf 跨包双向可赋值", () => {
    const sayA: Assignable<EditorCommandOf<"say">, CoreCommandOf<"say">> = true;
    const sayB: Assignable<CoreCommandOf<"say">, EditorCommandOf<"say">> = true;
    const menuA: Assignable<
      EditorCommandOf<"menu">,
      CoreCommandOf<"menu">
    > = true;
    const menuB: Assignable<
      CoreCommandOf<"menu">,
      EditorCommandOf<"menu">
    > = true;
    const setA: Assignable<EditorCommandOf<"set">, CoreCommandOf<"set">> = true;
    const setB: Assignable<CoreCommandOf<"set">, EditorCommandOf<"set">> = true;
    const retA: Assignable<
      EditorCommandOf<"return">,
      CoreCommandOf<"return">
    > = true;
    const retB: Assignable<
      CoreCommandOf<"return">,
      EditorCommandOf<"return">
    > = true;
    void sayA;
    void sayB;
    void menuA;
    void menuB;
    void setA;
    void setB;
    void retA;
    void retB;
  });

  it("嵌套 spec 同一性：作者侧派生类型 ↔ 负载侧声明", () => {
    const menuA: Assignable<MenuOptionSpec, MenuOptionPayload> = true;
    const menuB: Assignable<MenuOptionPayload, MenuOptionSpec> = true;
    const menuK: SameKeys<keyof MenuOptionSpec, keyof MenuOptionPayload> = true;
    const inputA: Assignable<InputCandidateSpec, InputCandidatePayload> = true;
    const inputB: Assignable<InputCandidatePayload, InputCandidateSpec> = true;
    const inputK: SameKeys<
      keyof InputCandidateSpec,
      keyof InputCandidatePayload
    > = true;
    void menuA;
    void menuB;
    void menuK;
    void inputA;
    void inputB;
    void inputK;
  });

  it("校验器能力面哨兵：editor CommandOf 经 core 转发仍可构造（bgm 代表）", () => {
    const bgm: EditorCommandOf<"bgm"> = { op: "bgm", resource: "music/a.ogg" };
    const asCore: CoreCommandOf<"bgm"> = bgm;
    expect(asCore.resource).toBe("music/a.ogg");
  });
});
