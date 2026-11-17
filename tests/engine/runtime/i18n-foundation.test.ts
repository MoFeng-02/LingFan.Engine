/**
 * I18N 底座测试：公共读口 engine.translate、展示值派生 deriveValue、
 * 翻译源 captureSource/readSources/writeSources 与源状态键治理。
 *
 * engine.translate 走真引擎 + I18nPort 契约替身（按契约 Mock，不 Mock 实现）；
 * deriveValue/sources 是内部模块（不经包出口），白盒直测——剖面只含被测函数
 * 会碰到的契约成员，查表/元素翻译接真实现，保证测的是真翻译路径。
 */
import { describe, expect, it } from "vitest";
import type { I18nOverlayFile } from "@lingfan-engine/core";
import { SYS, StoryEngine, parseStory } from "@lingfan-engine/core";
import type { ElementInstance } from "../../../packages/core/src/contracts/index.ts";
import {
  RESERVED_STATE_KEYS,
  SESSION_STATE_KEYS,
} from "../../../packages/core/src/contracts/runtime/state-keys.ts";
import type { OpContext } from "../../../packages/core/src/runtime/internal/context.ts";
import {
  I18N_DERIVED_KEYS,
  deriveValue,
} from "../../../packages/core/src/runtime/i18n/derive.ts";
import {
  captureSource,
  readSources,
  writeSources,
} from "../../../packages/core/src/runtime/i18n/sources.ts";
import {
  translate,
  translateElements,
} from "../../../packages/core/src/runtime/i18n/translate.ts";

/** I18nPort 契约替身：内存译文表（单 main.json 供给） */
class MemoryI18nPort {
  private readonly tables = new Map<string, Record<string, string>>();

  table(lang: string, entries: Record<string, string>): this {
    this.tables.set(lang, entries);
    return this;
  }

  async loadOverlayFiles(lang: string): Promise<I18nOverlayFile[]> {
    return [{ path: "main.json", entries: this.tables.get(lang) ?? {} }];
  }
}

function makeEngine(
  commands: object[],
  port?: MemoryI18nPort,
  defines?: Record<string, unknown>,
): StoryEngine {
  return new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "t",
      entry: "a",
      columns: [{ id: "a", kind: "flow", commands }],
      ...(defines !== undefined ? { defines } : {}),
    }),
    port ? { i18nPort: port } : {},
  );
}

/**
 * 派生用最小执行器剖面：deriveValue 只碰 overlay / translate / translateElements / state
 * 四个契约成员；查表与元素翻译接真实现，保证测的是真翻译路径而不是替身语义。
 * state 为空 Map ⇒ 无插值源，对话/说话人表面回退对状态值直译。
 */
function deriveCtx(table: Record<string, string> | null): OpContext {
  const ctx: OpContext = {
    overlay: table === null ? null : new Map(Object.entries(table)),
    state: new Map<string, unknown>(),
    translate: (original: string) => translate(ctx, original),
    translateElements: (instances: readonly ElementInstance[]) =>
      translateElements(ctx, instances),
  } as unknown as OpContext;
  return ctx;
}

/** 源读写用最小执行器剖面：只碰 state 与 setSystem（系统键写入通道） */
function stateCtx(): OpContext {
  const state = new Map<string, unknown>();
  return {
    state,
    setSystem: (key: string, value: unknown) => {
      state.set(key, value);
    },
  } as unknown as OpContext;
}

function el(
  id: string,
  text: unknown,
  children: ElementInstance[] = [],
): ElementInstance {
  return { id, type: "text", props: { text }, z: 0, children };
}

describe("engine.translate · 公共读口", () => {
  it("未装配端口 ⇒ 原文直出（空串直返）", () => {
    const engine = makeEngine([{ op: "say", text: "你好" }]);
    engine.start();
    expect(engine.translate("你好")).toBe("你好");
    expect(engine.translate("")).toBe("");
    engine.dispose();
  });

  it("命中即用译文（含空串译文），未命中回退原文", async () => {
    const port = new MemoryI18nPort().table("en", { 你好: "Hello", 空: "" });
    const engine = makeEngine([{ op: "say", text: "你好" }], port);
    engine.start();
    await engine.setLanguage("en");
    expect(engine.translate("你好")).toBe("Hello");
    expect(engine.translate("空")).toBe("");
    expect(engine.translate("未收录")).toBe("未收录");
    engine.dispose();
  });

  it("状态存原文：get 读口按当前语言派生译文，translate 读口按当前语言查表", async () => {
    const port = new MemoryI18nPort().table("en", { 你好: "Hello" });
    const engine = makeEngine([{ op: "say", text: "你好" }], port);
    engine.start();
    await engine.setLanguage("en");
    // say 把原文写入状态；切语言后 get 读口按当前语言派生译文（状态本身仍是原文）
    expect(engine.get(SYS.currentDialogText)).toBe("Hello");
    expect(engine.translate("你好")).toBe("Hello");
    engine.dispose();
  });

  it("先译后插值：translate 返回含占位符的译文模板，读口侧插值复现当前语言展示值", async () => {
    const port = new MemoryI18nPort().table("en", {
      "你好 {name}": "Hello {name}",
    });
    const engine = makeEngine([{ op: "say", text: "你好 {name}" }], port, {
      name: "世界",
    });
    engine.start();
    await engine.setLanguage("en");
    expect(engine.translate("你好 {name}")).toBe("Hello {name}");
    expect(engine.interpolate(engine.translate("你好 {name}"))).toBe(
      "Hello 世界",
    );
    // 状态存原文插值成品；切语言后 get 读口用捕获实参重译+重插值，得到当前语言展示值
    expect(engine.get(SYS.currentDialogText)).toBe("Hello 世界");
    engine.dispose();
  });

  it("切语言跟随当前译文表；切回默认语言（空串）⇒ 原文直出", async () => {
    const port = new MemoryI18nPort()
      .table("en", { 你好: "Hello" })
      .table("fr", { 你好: "Bonjour" });
    const engine = makeEngine([{ op: "say", text: "你好" }], port);
    engine.start();
    await engine.setLanguage("en");
    expect(engine.translate("你好")).toBe("Hello");
    await engine.setLanguage("fr");
    expect(engine.translate("你好")).toBe("Bonjour");
    await engine.setLanguage("");
    expect(engine.translate("你好")).toBe("你好");
    engine.dispose();
  });

  it("start 前即可用：先 setLanguage 后 translate 命中", async () => {
    const port = new MemoryI18nPort().table("en", { 你好: "Hello" });
    const engine = makeEngine([{ op: "say", text: "你好" }], port);
    await engine.setLanguage("en");
    expect(engine.translate("你好")).toBe("Hello");
    engine.dispose();
  });
});

describe("deriveValue · 展示值派生（唯一派生点）", () => {
  it("派生键集合锁定：恰为八个展示表面键", () => {
    expect([...I18N_DERIVED_KEYS].sort()).toEqual(
      [
        SYS.currentDialogText,
        SYS.currentDialogSpeaker,
        SYS.menuPrompt,
        SYS.menuOptions,
        SYS.inputPrompt,
        SYS.inputOptions,
        SYS.nvlBuffer,
        SYS.elements,
      ].sort(),
    );
  });

  it("非派生键 ⇒ 原值原引用（menuTargets 等不随语言变）", () => {
    const ctx = deriveCtx({ 攻击: "Attack" });
    const targets = ["a", "b"];
    expect(deriveValue(ctx, SYS.menuTargets, targets)).toBe(targets);
  });

  it("overlay 未装配 ⇒ 派生键也原值原引用", () => {
    const ctx = deriveCtx(null);
    const options = ["攻击"];
    expect(deriveValue(ctx, SYS.menuOptions, options)).toBe(options);
    expect(deriveValue(ctx, SYS.currentDialogText, "攻击")).toBe("攻击");
  });

  it("字符串表面：命中翻译、未命中回退、非字符串原样", () => {
    const ctx = deriveCtx({ 攻击: "Attack" });
    for (const key of [
      SYS.currentDialogText,
      SYS.currentDialogSpeaker,
      SYS.menuPrompt,
      SYS.inputPrompt,
    ]) {
      expect(deriveValue(ctx, key, "攻击")).toBe("Attack");
      expect(deriveValue(ctx, key, "未收录")).toBe("未收录");
      expect(deriveValue(ctx, key, 42)).toBe(42);
    }
  });

  it("文本列表（menuOptions / nvlBuffer）：逐条翻译，非字符串项与非数组原样", () => {
    const ctx = deriveCtx({ 攻击: "Attack" });
    for (const key of [SYS.menuOptions, SYS.nvlBuffer]) {
      expect(deriveValue(ctx, key, ["攻击", "防御"])).toEqual([
        "Attack",
        "防御",
      ]);
      expect(deriveValue(ctx, key, ["攻击", 7])).toEqual(["Attack", 7]);
      expect(deriveValue(ctx, key, "不是数组")).toBe("不是数组");
    }
  });

  it("输入候选：只译展示 text，提交 value 不查表；额外字段保留；畸形项原样", () => {
    const ctx = deriveCtx({ 攻击: "Attack", attack: "HACK" });
    const candidates = [
      { text: "攻击", value: "attack", extra: true },
      null,
      "x",
      { value: "v" },
    ];
    expect(deriveValue(ctx, SYS.inputOptions, candidates)).toEqual([
      { text: "Attack", value: "attack", extra: true },
      null,
      "x",
      { value: "v" },
    ]);
  });

  it("元素：props.text 递归翻译（含 children），非字符串 text 不碰", () => {
    const ctx = deriveCtx({ 攻击: "Attack", 防御: "Defend" });
    const instances = [el("a", "攻击", [el("b", "防御")]), el("c", 42)];
    const derived = deriveValue(
      ctx,
      SYS.elements,
      instances,
    ) as ElementInstance[];
    expect(derived[0].props.text).toBe("Attack");
    expect(derived[0].children[0].props.text).toBe("Defend");
    expect(derived[1].props.text).toBe(42);
    expect(deriveValue(ctx, SYS.elements, "不是数组")).toBe("不是数组");
  });

  it("纯读不改原值：冻结输入也能派生，原数组/对象内容不变", () => {
    const ctx = deriveCtx({ 攻击: "Attack" });
    const options = Object.freeze(["攻击"]);
    const candidates = Object.freeze([
      Object.freeze({ text: "攻击", value: "attack" }),
    ]);
    expect(deriveValue(ctx, SYS.menuOptions, options)).toEqual(["Attack"]);
    expect(deriveValue(ctx, SYS.inputOptions, candidates)).toEqual([
      { text: "Attack", value: "attack" },
    ]);
    expect(options[0]).toBe("攻击");
    expect(candidates[0].text).toBe("攻击");
  });
});

describe("sources · 翻译源捕获与读写", () => {
  it("captureSource：无实参不写 values 字段；有实参原样携带", () => {
    const plain = captureSource("你好");
    expect(plain).toEqual({ key: "你好" });
    expect("values" in plain).toBe(false);
    const values = { name: "世界" };
    expect(captureSource("你好 {name}", values)).toEqual({
      key: "你好 {name}",
      values,
    });
  });

  it("writeSources / readSources 往返一致（经系统键通道落状态）", () => {
    const ctx = stateCtx();
    const sources = {
      dialog: { key: "你好 {name}", values: { name: "世界" } },
      speaker: { key: "旁白" },
      menu: { prompt: { key: "请选择" }, options: [{ key: "攻击" }] },
      input: {
        prompt: { key: "输入名字" },
        candidates: [{ key: "攻击", values: { v: 1 } }],
      },
    };
    writeSources(ctx, sources);
    expect(ctx.state.get(SYS.i18nSources)).toBe(sources);
    expect(readSources(ctx)).toEqual(sources);
  });

  it("未写入 ⇒ 空（老存档降级，不抛错）", () => {
    expect(readSources(stateCtx())).toEqual({});
  });

  it("畸形值（字符串/数字/null/数组）⇒ 降级为空", () => {
    for (const bad of ["x", 42, null, []]) {
      const ctx = stateCtx();
      ctx.state.set(SYS.i18nSources, bad);
      expect(readSources(ctx)).toEqual({});
    }
  });

  it("源键治理：保留键（外部写不进）、非会话键（随存档不只随快照）", () => {
    expect(SYS.i18nSources).toBe("__i18n_sources");
    expect(RESERVED_STATE_KEYS.has(SYS.i18nSources)).toBe(true);
    expect(SESSION_STATE_KEYS.has(SYS.i18nSources)).toBe(false);
  });
});
