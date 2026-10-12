/**
 * 扩展 op 等待能力（E1 契约 + E2 运行时）验收门。
 *
 * 语义对齐 `interaction`（不新造等待语义）：声明 `wait: true` 的扩展 op 返回
 * `{ok:"wait"}` 即请求挂起，引擎建立等待点（写等待态 → 挂起记录 → 检查点 →
 * auto_save 消费点）并出站 `extension.mount`；宿主 `resolveExtensionOp` 回填
 * （四道守卫 fail-closed），中断随 `abortExternalTakeovers` 三路齐断。
 *
 * 故意错误：未声明而请求等待 / 非等待期解除 / op 不符 / 畸形结果 / 不可序列化回填。
 */
import { describe, expect, it, vi } from "vitest";
import type {
  ExtensionMountPayload,
  OpExtension,
  OutboundEvent,
  SaveMode,
  SavePort,
} from "@lingfan/engine";
import {
  BUILTIN_OP_NAMES,
  StoryEngine,
  SYS,
  WAITING_OPS,
  collectWaitSpecs,
  parseStory,
} from "@lingfan/engine";
import dispatchSource from "../../../packages/engine/src/runtime/dispatch.ts?raw";
import waitingSource from "../../../packages/engine/src/runtime/internal/waiting.ts?raw";

/** FNV-1a 32 位指纹（内联实现，WebView 无 Node——文件/进程必经 Rust 命令）：逐字节漂移检测用 */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** 双 op 扩展：demo_wait 声明等待并返回 wait 结果；demo_plain 未声明、正常步进 */
function waitExtension(overrides: Partial<OpExtension> = {}): OpExtension {
  return {
    id: "demo",
    stateVersion: 1,
    ops: [
      {
        op: "demo_wait",
        wait: true,
        exec: (_cmd, ctx) => {
          const runs =
            typeof ctx.get("runs") === "number"
              ? (ctx.get("runs") as number)
              : 0;
          ctx.set("runs", runs + 1);
          return {
            ok: "wait",
            config: { level: 3 },
            on_success: "ok",
            on_fail: "ng",
          };
        },
      },
      { op: "demo_plain", exec: () => ({ ok: true }) },
    ],
    ...overrides,
  };
}

/** 三列故事：s = 旅程起点，ok/ng = on_success/on_fail 分流落点（热重载用例复用同一构造） */
function buildStory(entry: object[]) {
  return parseStory({
    formatVersion: 1,
    id: "demo",
    columns: [
      {
        id: "s",
        kind: "flow",
        commands: [...entry, { op: "say", text: "落点" }],
      },
      { id: "ok", kind: "flow", commands: [{ op: "say", text: "成功分支" }] },
      { id: "ng", kind: "flow", commands: [{ op: "say", text: "失败分支" }] },
    ],
  });
}

function makeEngine(
  entry: object[],
  options: { extensions?: readonly OpExtension[]; savePort?: SavePort } = {},
): { engine: StoryEngine; errors: OutboundEvent[]; events: OutboundEvent[] } {
  const engine = new StoryEngine(buildStory(entry), options);
  const errors: OutboundEvent[] = [];
  const events: OutboundEvent[] = [];
  engine.onEvent((e) => {
    events.push(e);
    if (e.payload.kind === "engine.error") errors.push(e);
  });
  engine.start();
  return { engine, errors, events };
}

function errorCodes(errors: OutboundEvent[]): string[] {
  return errors.map((e) =>
    e.payload.kind === "engine.error" ? e.payload.code : "",
  );
}

function mounts(events: OutboundEvent[]): ExtensionMountPayload[] {
  return events
    .filter(
      (e): e is OutboundEvent & { payload: ExtensionMountPayload } =>
        e.payload.kind === "extension.mount",
    )
    .map((e) => e.payload);
}

/** 过一句 say 后停在 demo_wait 挂载上的旅程（中断/重放用例的公共起点） */
function mountedJourney(): { engine: StoryEngine; events: OutboundEvent[] } {
  const { engine, events } = makeEngine(
    [{ op: "say", text: "一" }, { op: "demo_wait" }],
    {
      extensions: [waitExtension()],
    },
  );
  engine.advance(); // 第一句解除 → demo_wait 建立等待
  return { engine, events };
}

describe("扩展 op 等待 · 声明位", () => {
  it("ext-op-wait-declaration：未声明 wait 请求等待 → custom-op-wait-undeclared 状态原样；声明了不等待 = 合法假边界", () => {
    // 未声明：第三态被拒——不出站挂载、等待态从未建立、停在当前命令
    const sneaky = waitExtension({
      ops: [{ op: "sneaky_wait", exec: () => ({ ok: "wait" }) }],
    });
    const undeclared = makeEngine([{ op: "sneaky_wait" }], {
      extensions: [sneaky],
    });
    expect(errorCodes(undeclared.errors)).toContain(
      "custom-op-wait-undeclared",
    );
    expect(undeclared.engine.get(SYS.waiting)).toBeUndefined();
    expect(mounts(undeclared.events)).toHaveLength(0);
    expect(undeclared.engine.get(SYS.currentDialogText)).toBeUndefined(); // 未步进到落点
    // 声明但不等待：合法——正常步进进对话等待，无挂载
    const quiet = makeEngine([{ op: "demo_plain" }], {
      extensions: [waitExtension()],
    });
    expect(errorCodes(quiet.errors)).toHaveLength(0);
    expect(quiet.engine.get(SYS.waiting)).toBe("dialog");
    expect(mounts(quiet.events)).toHaveLength(0);
    // 声明驱动静态合并面：wait:true 进 collectWaitSpecs（state 恒 extension），内建行原样
    const merged = collectWaitSpecs([waitExtension()]);
    expect(merged.get("demo_wait")).toEqual({ state: "extension" });
    expect(merged.get("demo_plain")).toBeUndefined();
    expect(merged.get("say")).toEqual({ state: "dialog" });
    expect(merged.get("pause")).toEqual({ state: "wait", hard: true });
    expect(merged.size).toBe(WAITING_OPS.size + 1);
    // 内建取值面不解释扩展：waitingStateOfOp 对扩展 op 恒 none（waiting-ops.test.ts 互锁的前提）
    expect(WAITING_OPS.get("demo_wait")).toBeUndefined();
  });
});

describe("扩展 op 等待 · 互锁", () => {
  it("op-registry-builtin-parity：分发 case 全集 = 内建清单；等待表 ⊆ 内建；内建 switch 切片逐字节等价", () => {
    const start = dispatchSource.indexOf("switch (cmd.op) {");
    const end = dispatchSource.indexOf("default:", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const slice = dispatchSource.slice(start, end);
    const dispatchCases = new Set(
      [...slice.matchAll(/case "([^"]+)":/g)].map((m) => m[1]!),
    );
    expect(dispatchCases).toEqual(BUILTIN_OP_NAMES);
    for (const op of WAITING_OPS.keys())
      expect(BUILTIN_OP_NAMES.has(op)).toBe(true);
    // 扩展查找前置 + 三态落点只动了前缀；switch 体逐字节钉死（改一字节即红）
    // P3 call into 结果通道：case return 透传 cmd（execReturn 求值带值 return）
    // ——哈希随之重算钉扎（2026-10-12，t11 契约内变更）
    expect(fnv1a(slice)).toBe(3032215097);
    // 中断入口三路齐备：小游戏 / 玩法系统 / 扩展 op（少一路 = 回溯后旧接管还在跑）
    const takeover = waitingSource.slice(
      waitingSource.indexOf("export function abortExternalTakeovers"),
    );
    expect(takeover).toContain("ctx.abortMinigame()");
    expect(takeover).toContain("ctx.abortInteraction()");
    expect(takeover).toContain("ctx.abortExtensionOp()");
  });
});

describe("扩展 op 等待 · 建立等待", () => {
  it("ext-op-wait-checkpoint：等待态 extension + 检查点提交 + auto_save 消费点 + mount 负载", () => {
    const { engine, events } = makeEngine([{ op: "demo_wait" }], {
      extensions: [waitExtension()],
    });
    expect(engine.get(SYS.waiting)).toBe("extension");
    expect(engine.historyCursor()).toBeGreaterThanOrEqual(0); // 等待建立即提交检查点
    const [first] = mounts(events);
    expect(first).toBeDefined();
    expect(first!.op).toBe("demo_wait");
    expect(first!.extensionId).toBe("demo");
    expect(first!.config).toEqual({ level: 3 });
    expect(first!.seq).toBe(1);
    expect(first!.signal.aborted).toBe(false);
    // auto_save 消费点：等画面前置 auto_save 声明 → 检查点落 auto 档；未声明则不消费。
    // mock 须独立变量持有：字面量直接赋给 SavePort.write 会被窄化成方法类型，.mock 不存在；
    // 泛型给出槽位签名（slot/payload/mode），零参实现可赋值且 mock.calls[0][0] 类型收敛为 slot
    const write = vi.fn<
      (slot: string, payload: string, mode: SaveMode) => Promise<void>
    >(async () => {});
    const savePort: SavePort = {
      write,
      read: async () => "",
      remove: async () => {},
      list: async () => [],
    };
    makeEngine([{ op: "auto_save", enabled: true }, { op: "demo_wait" }], {
      extensions: [waitExtension()],
      savePort,
    });
    expect(write).toHaveBeenCalled();
    expect(write.mock.calls[0]![0]).toBe("auto");
    const bare = makeEngine([{ op: "demo_wait" }], {
      extensions: [waitExtension()],
      savePort,
    });
    expect(write).toHaveBeenCalledTimes(1); // bare 建立等待但开关未开 → 不追加
    expect(bare.engine.get(SYS.waiting)).toBe("extension");
  });
});

describe("扩展 op 等待 · 解除", () => {
  it("ext-op-wait-resolve：四道守卫逐个命中；回填 game.<id>.<key>；分流 on_success/on_fail", () => {
    // 守卫①：非扩展等待期解除 → extension-resolve-invalid
    const idle = makeEngine([{ op: "say", text: "一" }], {
      extensions: [waitExtension()],
    });
    expect(
      idle.engine.resolveExtensionOp("demo_wait", { outcome: "success" }),
    ).toBe(false);
    expect(errorCodes(idle.errors)).toContain("extension-resolve-invalid");
    // 守卫②：挂起记录缺失 → extension-state-corrupt（黑盒不可达：每次中断都经重放重建记录，白盒探针锁守卫）
    const corrupt = makeEngine([{ op: "demo_wait" }], {
      extensions: [waitExtension()],
    });
    (
      corrupt.engine as unknown as { ctx: { pendingExtensionOp: unknown } }
    ).ctx.pendingExtensionOp = null;
    expect(
      corrupt.engine.resolveExtensionOp("demo_wait", { outcome: "success" }),
    ).toBe(false);
    expect(errorCodes(corrupt.errors)).toContain("extension-state-corrupt");
    // 守卫③：op 不符 → extension-op-mismatch（身份键 = op，引擎注册表键）
    const journey = makeEngine([{ op: "demo_wait" }], {
      extensions: [waitExtension()],
    });
    expect(
      journey.engine.resolveExtensionOp("other_op", { outcome: "success" }),
    ).toBe(false);
    expect(errorCodes(journey.errors)).toContain("extension-op-mismatch");
    // 守卫④：畸形结果 → extension-result-invalid（outcome 非法 / state 非对象）；守卫后状态原样可再解除
    for (const bad of [
      null,
      {},
      { outcome: "maybe" },
      { outcome: "success", state: [] },
      { outcome: "success", state: null },
    ]) {
      expect(journey.engine.resolveExtensionOp("demo_wait", bad as never)).toBe(
        false,
      );
      expect(errorCodes(journey.errors).at(-1)).toBe(
        "extension-result-invalid",
      );
      expect(journey.engine.get(SYS.waiting)).toBe("extension");
    }
    // 回填值不可序列化 → value-not-serializable，等待保持（重试合法）
    expect(
      journey.engine.resolveExtensionOp("demo_wait", {
        outcome: "success",
        state: { bad: () => 1 } as never,
      }),
    ).toBe(false);
    expect(errorCodes(journey.errors).at(-1)).toBe("value-not-serializable");
    expect(journey.engine.get(SYS.waiting)).toBe("extension");
    // 成功解除：state 落 game.demo.* 命名空间 → 分流 on_success 列 → 继续执行
    expect(
      journey.engine.resolveExtensionOp("demo_wait", {
        outcome: "success",
        state: { hp: 99, tag: "ok" },
      }),
    ).toBe(true);
    expect(journey.engine.get("game.demo.hp")).toBe(99);
    expect(journey.engine.get("game.demo.tag")).toBe("ok");
    expect(journey.engine.get(SYS.currentDialogText)).toContain("成功分支");
    // 流已前进：再解除 = 非扩展等待期
    expect(
      journey.engine.resolveExtensionOp("demo_wait", { outcome: "success" }),
    ).toBe(false);
    // 失败解除：分流 on_fail 列
    const failing = makeEngine([{ op: "demo_wait" }], {
      extensions: [waitExtension()],
    });
    expect(
      failing.engine.resolveExtensionOp("demo_wait", { outcome: "fail" }),
    ).toBe(true);
    expect(failing.engine.get(SYS.currentDialogText)).toContain("失败分支");
    // 无分流目标：原地顺延（落到扩展 op 后的落点 say）
    const plain = makeEngine([{ op: "demo_wait" }], {
      extensions: [
        waitExtension({
          ops: [{ op: "demo_wait", wait: true, exec: () => ({ ok: "wait" }) }],
        }),
      ],
    });
    expect(
      plain.engine.resolveExtensionOp("demo_wait", { outcome: "success" }),
    ).toBe(true);
    expect(plain.engine.get(SYS.currentDialogText)).toContain("落点");
  });
});

describe("扩展 op 等待 · 中断", () => {
  it("ext-op-wait-abort：五处中断点（回溯/导航/读档/热重载/销毁）各自 abort 挂载信号", () => {
    const interruptions: [
      string,
      (journey: { engine: StoryEngine; events: OutboundEvent[] }) => void,
    ][] = [
      ["回溯", ({ engine }) => engine.back()],
      ["导航", ({ engine }) => engine.navigate("ng")],
      ["读档", ({ engine }) => engine.importSave(engine.exportSave()!)],
      [
        "热重载",
        ({ engine }) =>
          engine.reloadStory(
            buildStory([{ op: "say", text: "一" }, { op: "demo_wait" }]),
          ),
      ],
      ["销毁", ({ engine }) => engine.dispose()],
    ];
    for (const [label, act] of interruptions) {
      const { engine, events } = mountedJourney();
      const [first] = mounts(events);
      expect(first!.signal.aborted, label).toBe(false);
      act({ engine, events });
      expect(first!.signal.aborted, label).toBe(true);
    }
    // 读档恢复：等待态随档——重放后在同一 op 上重新挂载（新 seq 新 signal）
    const { engine, events } = mountedJourney();
    engine.importSave(engine.exportSave()!);
    expect(engine.get(SYS.waiting)).toBe("extension");
    expect(mounts(events)).toHaveLength(2);
    expect(mounts(events)[1]!.seq).toBe(2);
  });
});

describe("扩展 op 等待 · 重放", () => {
  it("ext-op-wait-replay：回溯→重新挂载 = 新 seq 新 signal 同坐标原位替换（检查点不增、exec 可重入）", () => {
    const { engine, events } = mountedJourney();
    const lengthBefore = engine.historyLength();
    const [first] = mounts(events);
    engine.back(); // 回到 say 检查点：等待解除（信号 abort），重放到该坐标重新挂载
    expect(first!.signal.aborted).toBe(true);
    engine.forward(); // 重放越过 demo_wait：重新执行、重新挂载
    const replays = mounts(events);
    expect(replays).toHaveLength(2);
    expect(replays[1]!.seq).toBe(2); // 单调序号：重放可分辨
    expect(replays[1]!.signal).not.toBe(first!.signal); // 新句柄
    expect(replays[1]!.op).toBe("demo_wait");
    expect(replays[1]!.extensionId).toBe("demo");
    expect(engine.historyLength()).toBe(lengthBefore); // 同坐标原位替换：不新增检查点
    expect(engine.get(SYS.waiting)).toBe("extension");
    // 重放 = 恢复该检查点快照（runs=1）再重新执行 op（→2）：重新挂载而非复制旧挂载
    expect(engine.get("ext.demo.runs")).toBe(2);
  });
});

describe("扩展 op 等待 · 状态归属", () => {
  it("custom-op-state-persist：扩展写入随快照/存档/回溯随行（同一 SSOT 存储，无独立账本）", () => {
    const writer = waitExtension({
      ops: [
        {
          op: "demo_write",
          exec: (_cmd, ctx) => {
            ctx.set("step", "接取");
            return { ok: true };
          },
        },
      ],
    });
    // 写入进 SSOT（门卫前缀强制 ext.demo. 命名空间），与内建变量同一存储
    // 旅程两端放 say（等待点建检查点）：检查点 0 = 写入前，检查点 1 = 写入后
    const { engine } = makeEngine(
      [
        { op: "say", text: "一" },
        { op: "demo_write" },
        { op: "say", text: "二" },
      ],
      { extensions: [writer] },
    );
    // say 一 挂起对话等待 → 先推进越过它，demo_write 才执行（say 二 再挂起）
    engine.advance();
    expect(engine.get("ext.demo.step")).toBe("接取");
    // 存档随行：exportSave 的 state 对里带着扩展键（exportSave 返回对象，state 是键值对数组）
    const save = engine.exportSave()!;
    expect((save as { state: [string, unknown][] }).state).toContainEqual([
      "ext.demo.step",
      "接取",
    ]);
    // 回溯随行：回滚到列首检查点，扩展写入随快照消失
    engine.rollbackTo(0);
    expect(engine.get("ext.demo.step")).toBeUndefined();
    // 前滚/读档随行：快照恢复（含检查点后的扩展写入）与存档恢复都带回扩展态
    engine.rollbackTo(1);
    expect(engine.get("ext.demo.step")).toBe("接取");
    engine.importSave(save);
    expect(engine.get("ext.demo.step")).toBe("接取");
  });
});

describe("扩展 op 等待 · 元素动作白名单", () => {
  it("判定⑥：interaction/extension 等待期 runElementOps 可用（接管画面也是被暂停的叙事）", () => {
    // interaction 等待期（既存缺陷补漏）：元素动作可用
    const sys = makeEngine([{ op: "interaction", system: "walk" }]);
    expect(sys.engine.get(SYS.waiting)).toBe("interaction");
    expect(
      sys.engine.runElementOps([{ op: "set", key: "touched", value: 1 }]),
    ).toBe(true);
    expect(sys.engine.get("touched")).toBe(1);
    // extension 等待期：同样可用，且写入进 SSOT
    const ext = mountedJourney();
    expect(ext.engine.get(SYS.waiting)).toBe("extension");
    expect(
      ext.engine.runElementOps([{ op: "set", key: "touched", value: 2 }]),
    ).toBe(true);
    expect(ext.engine.get("touched")).toBe(2);
  });
});
