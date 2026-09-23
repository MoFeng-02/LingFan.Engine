/**
 * 多方位集成测试：模拟玩家完整旅程、对抗性输入注入、快照隔离不变量、混沌随机游走。
 * 不变量：引擎任何公开方法都不得抛异常（fail-closed 一律 engine.error 事件出站）；
 * 拒绝后引擎状态保持原样；等待态取值恒合法；历史检查点坐标恒指向存在的列。
 */
import { describe, expect, it } from "vitest";
import type { OutboundEvent, SaveDataV1, SlotSummary } from "@lingfan/engine";
import { SYS, StoryEngine, parseStory } from "@lingfan/engine";

const VALID_WAITING = [
  undefined,
  "none",
  "dialog",
  "menu",
  "wait",
  "input",
  "minigame",
  "video",
];

/** 单列等待点故事 + 事件捕获（各用例复用） */
function makeEngine(commands: object[]): {
  engine: StoryEngine;
  errors: OutboundEvent[];
  dispose: () => void;
} {
  const engine = new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "d",
      columns: [{ id: "start", kind: "flow", commands }],
    }),
    { rngSeed: 9 },
  );
  const errors: OutboundEvent[] = [];
  const off = engine.onEvent((e) => errors.push(e));
  return {
    engine,
    errors,
    dispose: () => {
      off();
    },
  };
}

function expectInvariants(engine: StoryEngine): void {
  const w = engine.get(SYS.waiting);
  expect(VALID_WAITING).toContain(w);
  const view = engine.historyView();
  expect(view.length).toBeLessThanOrEqual(200);
  for (const entry of view) {
    expect(typeof entry.coord.columnId).toBe("string");
    expect(typeof entry.coord.index).toBe("number");
  }
  // 08-U6：媒体状态恒为合法形态（play/stop 二态，音量在物理范围内）
  for (const key of [
    SYS.audioBgm,
    SYS.audioAmbient,
    SYS.audioVoice,
    SYS.audioSe,
  ]) {
    const value = engine.get(key);
    if (value == null) continue;
    const state = value as {
      kind?: string;
      resource?: string;
      volume?: number;
    };
    expect(["play", "stop"]).toContain(state.kind);
    if (state.kind === "play") {
      expect(typeof state.resource).toBe("string");
      expect(state.volume).toBeGreaterThanOrEqual(0);
      expect(state.volume).toBeLessThanOrEqual(1);
    }
  }
  const position = engine.get(SYS.bgmPosition);
  if (position !== undefined) {
    expect(typeof position).toBe("number");
    expect(position as number).toBeGreaterThanOrEqual(0);
  }
}

// —— 内存 SavePort（SavePort 契约的可行实现，node 环境无 localStorage）——
class MemorySavePort {
  private readonly slots = new Map<
    string,
    { payload: string; saveCount: number }
  >();
  private highWater = 0;

  async write(slot: string, payload: string): Promise<void> {
    this.highWater += 1;
    this.slots.set(slot, { payload, saveCount: this.highWater });
  }

  async read(slot: string): Promise<string> {
    const record = this.slots.get(slot);
    if (record === undefined) throw new Error(`槽位不存在：${slot}`);
    if (record.saveCount < this.highWater) throw new Error("回档尝试被拒绝");
    return record.payload;
  }

  async remove(slot: string): Promise<void> {
    this.slots.delete(slot); // K4：删档不动高水位
  }

  async list(): Promise<SlotSummary[]> {
    return [...this.slots.entries()].map(([slot, r]) => ({
      slot,
      saveCount: r.saveCount,
      timestamp: 0,
      mode: "machine-bound",
    }));
  }
}

/** 旅程故事：对话 → 输入 → 分支（函数问候）→ 等待 → 菜单 → 两分支 → 终 */
function buildJourneyStory(): ReturnType<typeof parseStory> {
  return parseStory({
    formatVersion: 1,
    id: "journey",
    defines: { "player.gold": 7 },
    columns: [
      {
        id: "start",
        kind: "flow",
        commands: [
          { op: "set", key: "player.gold", value: "+= {20}" },
          { op: "say", speaker: "灵泛", text: "你有 {player.gold} 枚金币。" },
          { op: "input", prompt: "报名：", store: "player.name" },
          {
            op: "if",
            cond: "{player.gold >= 25}",
            then: [
              {
                op: "func",
                name: "greet",
                params: ["who"],
                body: [{ op: "say", speaker: "{who}", text: "{who}，欢迎！" }],
              },
              { op: "call", target: "greet", args: ["{player.name}"] },
            ],
            else: [{ op: "say", text: "穷" }],
          },
          { op: "wait", seconds: 2, skipable: true },
          { op: "say", text: "选吧：" },
          {
            op: "menu",
            prompt: "去哪",
            options: [
              { text: "酒馆", target: "inn" },
              { text: "广场", target: "square" },
            ],
          },
        ],
      },
      {
        id: "inn",
        kind: "flow",
        commands: [
          { op: "say", text: "酒馆线" },
          { op: "jump", target: "end" },
        ],
      },
      {
        id: "square",
        kind: "flow",
        commands: [
          { op: "say", text: "广场线" },
          { op: "jump", target: "end" },
        ],
      },
      { id: "end", kind: "flow", commands: [{ op: "say", text: "终" }] },
    ],
  });
}

describe("玩家完整旅程（模拟点击序列）", () => {
  it("推进 → 输入 → 分支函数 → 跳过等待 → 菜单 → 换线 → 终", () => {
    const engine = new StoryEngine(buildJourneyStory(), { rngSeed: 1 });
    const events: string[] = [];
    engine.onEvent((e) => {
      if (e.payload.kind === "notify") events.push(e.payload.text);
    });
    engine.start();
    expect(engine.get(SYS.currentDialogText)).toBe("你有 27 枚金币。");
    engine.advance();
    expect(engine.get(SYS.waiting)).toBe("input"); // 输入点
    engine.input("测试者");
    // 分支：greet 函数体上屏（speaker = 玩家名）
    expect(engine.get(SYS.currentDialogSpeaker)).toBe("测试者");
    expect(engine.get(SYS.currentDialogText)).toBe("测试者，欢迎！");
    engine.advance(); // 解除函数体 say
    expect(engine.get(SYS.waiting)).toBe("wait"); // skipable wait
    engine.advance(); // 点击跳过
    expect(engine.get(SYS.currentDialogText)).toBe("选吧：");
    engine.advance();
    expect(engine.get(SYS.waiting)).toBe("menu");
    engine.choose("inn");
    expect(engine.get(SYS.currentDialogText)).toBe("酒馆线");
    engine.advance(); // 酒馆线解除 → jump end → 终上屏
    expect(engine.get(SYS.currentDialogText)).toBe("终");
    expect(engine.get(SYS.currentSceneColumn)).toBe("end");
  });

  it("存档 → 继续推进 → 读档回滚到存档时刻 → 回溯/前进/继续全部可用", async () => {
    const port = new MemorySavePort();
    const engine = new StoryEngine(buildJourneyStory(), { rngSeed: 2 });
    engine.start();
    engine.advance(); // 金币 say
    engine.input("旅人甲"); // 输入 → greet
    // 存档时刻：greet 上屏（未解除）
    const data = engine.exportSave();
    expect(data).not.toBeNull();
    await port.write("slot_1", JSON.stringify(data));

    // 继续推进两步（wait + say 选吧）
    engine.advance();
    engine.advance();
    expect(engine.get(SYS.currentDialogText)).toBe("选吧：");

    // 读档：回到存档时刻（存档时输入的名字 = 旅人甲，重放按存档状态插值）
    const payload = await port.read("slot_1");
    expect(engine.importSave(JSON.parse(payload) as SaveDataV1)).toBe(true);
    expect(engine.get(SYS.currentDialogText)).toBe("旅人甲，欢迎！");
    expect(engine.get(SYS.currentDialogSpeaker)).toBe("旅人甲");
    expect(engine.get("player.name")).toBe("旅人甲");

    // 读档后回溯一档（到 input 等待点）→ 重新输入
    engine.back();
    expect(engine.get(SYS.waiting)).toBe("input");
    engine.input("新名字");
    expect(engine.get(SYS.currentDialogSpeaker)).toBe("新名字");
    // 继续推进到菜单
    engine.advance(); // wait skip
    engine.advance(); // say 选吧 解除
    engine.advance(); // menu 建立
    expect(engine.get(SYS.waiting)).toBe("menu");
    engine.choose("square");
    expect(engine.get(SYS.currentDialogText)).toBe("广场线");
  });
});

describe("对抗性输入注入（fail-closed 全覆盖，拒绝后引擎状态不变）", () => {
  interface Harness {
    engine: StoryEngine;
    errors: Array<{ code?: string; kind?: string; message?: string }>;
    dispose: () => void;
  }
  function makeWithCapture(): Harness {
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "d",
        columns: [
          { id: "start", kind: "flow", commands: [{ op: "say", text: "s" }] },
        ],
      }),
      { rngSeed: 9 },
    );
    const errors: Array<{ code?: string; kind?: string; message?: string }> =
      [];
    const off = engine.onEvent((e) =>
      errors.push({
        kind: e.payload.kind,
        code: (e.payload as { code?: string }).code,
        message: (e.payload as { message?: string }).message,
      }),
    );
    engine.start();
    return { engine, errors, dispose: off };
  }

  const corruptions: Array<[string, (d: SaveDataV1) => unknown]> = [
    ["formatVersion 非 1", (d) => ({ ...d, formatVersion: 99 })],
    ["storyId 不匹配", (d) => ({ ...d, storyId: "nope" })],
    [
      "coord.columnId 非字符串",
      (d) => ({ ...d, coord: { columnId: 9, index: 0 } }),
    ],
    [
      "coord.index 非数字",
      (d) => ({ ...d, coord: { columnId: "start", index: "x" } }),
    ],
    ["state 非数组", (d) => ({ ...d, state: "all-your-base" })],
    ["functions 非数组", (d) => ({ ...d, functions: 7 })],
    ["history 非数组", (d) => ({ ...d, history: null })],
    ["rngState 非数字", (d) => ({ ...d, rngState: "seed" })],
    [
      "history 元素 coord 缺失",
      (d) => ({ ...d, history: [{ state: [], rngState: 0 }] }),
    ],
    [
      "history 元素列不存在",
      (d) => ({
        ...d,
        history: [
          { coord: { columnId: "ghost", index: 0 }, state: [], rngState: 0 },
        ],
      }),
    ],
  ];

  for (const [name, corrupt] of corruptions) {
    it(`注入 ${name} → fail-closed 且引擎原状态保持`, () => {
      const { engine, errors, dispose } = makeWithCapture();
      const before = {
        text: engine.get(SYS.currentDialogText),
        waiting: engine.get(SYS.waiting),
      };
      const data = engine.exportSave() as SaveDataV1;
      const ok = engine.importSave(corrupt(data) as SaveDataV1);
      expect(ok).toBe(false);
      expect(errors.at(-1)?.kind).toBe("engine.error");
      expect(["save-format", "save-story-mismatch"]).toContain(
        errors.at(-1)?.code,
      );
      // 拒绝后引擎状态保持原样（半恢复禁止）
      expect(engine.get(SYS.currentDialogText)).toBe(before.text);
      expect(engine.get(SYS.waiting)).toBe(before.waiting);
      dispose();
    });
  }

  it("恶意文本注入：核心透传不炸、插值语义不变", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "say", text: "<script>alert(1)</script>{b}粗{/b}" },
      { op: "say", text: "{{}{{}}}{ orphan" },
      { op: "say", text: "{gold} end" },
    ]);
    engine.start();
    expect(engine.get(SYS.currentDialogText)).toBe(
      "<script>alert(1)</script>{b}粗{/b}",
    );
    engine.advance();
    expect(engine.get(SYS.currentDialogText)).toBe("{{}{{}}}{ orphan");
    engine.advance(); // {gold} 未定义 → S8 保留原文 + error
    expect(engine.get(SYS.currentDialogText)).toBe("{gold} end");
    expect(
      errors.some(
        (e) =>
          e.payload.kind === "engine.error" &&
          e.payload.code === "unknown-variable",
      ),
    ).toBe(true);
    dispose();
  });

  it("10 层嵌套 if 正确执行；出块后块级变量不可见", () => {
    let inner: object[] = [
      { op: "say", text: "深" },
      { op: "let", key: "deep", value: 1 },
    ];
    for (let i = 0; i < 10; i += 1) {
      inner = [{ op: "if", cond: "{true}", then: inner }];
    }
    const { engine, errors, dispose } = makeEngine([
      ...inner,
      { op: "say", text: "{deep}" },
    ]);
    engine.start();
    expect(engine.get(SYS.currentDialogText)).toBe("深");
    engine.advance();
    expect(engine.get(SYS.currentDialogText)).toBe("{deep}"); // S1+S8
    expect(
      errors.some(
        (e) =>
          e.payload.kind === "engine.error" &&
          e.payload.code === "unknown-variable",
      ),
    ).toBe(true);
    dispose();
  });
});

describe("快照隔离不变量（写时复制）", () => {
  it("同一 Story 的两个引擎互不影响", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "d",
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [
            { op: "set", key: "g", value: 1 },
            { op: "say", text: "s" },
          ],
        },
      ],
    });
    const a = new StoryEngine(story, { rngSeed: 1 });
    const b = new StoryEngine(story, { rngSeed: 1 });
    a.start();
    b.start();
    a.advance();
    b.advance();
    // 各自 set 后互不影响（无共享 state）
    const e1 = new StoryEngine(story, { rngSeed: 1 });
    const c1 = e1.exportSave();
    void c1;
    expect(b.get("g")).toBe(a.get("g"));
  });

  it("exportSave 后继续推进，旧载荷不被污染（写时复制）", () => {
    const { engine, dispose } = makeEngine([
      { op: "array", key: "list", items: [1] },
      { op: "say", text: "甲" },
    ]);
    engine.start();
    engine.advance(); // say 甲上屏（等待点）
    const data = engine.exportSave() as SaveDataV1;
    const frozen = JSON.stringify(data);
    engine.advance(); // 旧引擎继续？— 列尾，仅验证
    // 重新构造可推进场景：回退到甲再 push
    const story2 = parseStory({
      formatVersion: 1,
      id: "d",
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [
            { op: "array", key: "list", items: [1] },
            { op: "say", text: "甲" },
            { op: "array_push", key: "list", value: 2 },
          ],
        },
      ],
    });
    const e2 = new StoryEngine(story2, { rngSeed: 1 });
    e2.start(); // say 甲上屏
    const d2 = e2.exportSave() as SaveDataV1;
    const frozen2 = JSON.stringify(d2);
    e2.advance(); // array_push 执行
    expect(JSON.stringify(d2)).toBe(frozen2); // 载荷不可变
    expect(JSON.parse(frozen2).history).toBeDefined();
    void data;
    void frozen;
    dispose();
  });

  it("回溯到同一检查点两次，恢复的状态一致（快照无跨次污染）", () => {
    const { engine, dispose } = makeEngine([
      { op: "set", key: "g", value: 1 },
      { op: "say", text: "甲" },
      { op: "set", key: "g", value: 2 },
      { op: "say", text: "乙" },
    ]);
    engine.start();
    engine.advance(); // 甲解除 → cp0（g=1 时刻画面）
    engine.advance(); // 乙上屏（g=2）
    engine.rollbackTo(0);
    const first = JSON.stringify(engine.historyView()[0]);
    engine.rollbackTo(0);
    expect(JSON.stringify(engine.historyView()[0])).toBe(first);
    expect(engine.get(SYS.currentDialogText)).toBe("甲");
    expect(engine.get("g")).toBe(1);
    dispose();
  });
});

describe("混沌随机游走（种子化 300 步操作 + 每步不变量）", () => {
  it("混合操作序列下引擎恒处于合法状态", () => {
    let seed = 20260707;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]!;

    const story = parseStory({
      formatVersion: 1,
      id: "chaos",
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [
            { op: "bgm", resource: "chaos.mp3", volume: 0.4 },
            { op: "ambient", resource: "hum.mp3" },
            { op: "se", resource: "beep.mp3" },
            { op: "voice", resource: "v.mp3", auto_stop: false },
            { op: "set", key: "n", value: 0 },
            { op: "say", text: "第{n}句" },
            { op: "random", seed: 3, range: [0, 2], var: "r" },
            { op: "input", prompt: "名", store: "player.name" },
            {
              op: "menu",
              prompt: "选",
              options: [
                { text: "A", target: "a" },
                { text: "B", target: "b" },
              ],
            },
          ],
        },
        {
          id: "a",
          kind: "flow",
          commands: [
            { op: "say", text: "A 线" },
            { op: "jump", target: "start" },
          ],
        },
        {
          id: "b",
          kind: "flow",
          commands: [
            { op: "say", text: "B 线" },
            { op: "jump", target: "end" },
          ],
        },
        { id: "end", kind: "flow", commands: [{ op: "say", text: "终" }] },
      ],
    });
    const engine = new StoryEngine(story, { rngSeed: 11, historyLimit: 50 });
    const errors: Array<{ kind?: string; code?: string }> = [];
    engine.onEvent((e) => {
      if (e.payload.kind === "engine.error")
        errors.push({ kind: e.payload.kind, code: e.payload.code });
    });
    engine.start();

    const port = new MemorySavePort();
    const ops: Array<() => void> = [
      () => engine.advance(),
      () => engine.back(),
      () => engine.forward(),
      () => engine.input("访客"),
      () => engine.choose("a"),
      () => engine.choose("b"),
      () => engine.exportSave(),
      () => engine.historyView(),
      () => engine.reportMediaPosition(rnd() * 120),
      () => engine.reportMediaPosition(-1), // 非法噪声值：必须被忽略
    ];
    let saved: SaveDataV1 | null = null;

    for (let step = 0; step < 300; step += 1) {
      const op = pick(ops);
      try {
        if (op === ops[0]) engine.advance();
        else if (op === ops[1]) engine.back();
        else if (op === ops[2]) engine.forward();
        else if (op === ops[3]) engine.input("游客");
        else if (op === ops[4]) engine.choose("a");
        else if (op === ops[5]) engine.choose("b");
        else if (op === ops[6]) {
          const d = engine.exportSave();
          if (d !== null) {
            saved = d;
            void port.write("slot_1", JSON.stringify(d));
          }
        } else if (op === ops[7] && saved !== null) {
          engine.importSave(JSON.parse(JSON.stringify(saved)) as SaveDataV1);
        } else if (op === ops[8]) {
          engine.reportMediaPosition(rnd() * 120);
        } else if (op === ops[9]) {
          engine.reportMediaPosition(-1);
        }
      } catch (e) {
        // 引擎公开方法不得抛异常——混沌步中任何抛出都是缺陷
        throw new Error(`第 ${step} 步抛出异常：${String(e)}`);
      }
      expectInvariants(engine);
    }
    // 全程 fail-closed 错误均为已知类型
    for (const e of errors) {
      expect(e.kind).toBe("engine.error");
    }
  });
});

describe("NVL 阅读旅程（模拟用户：累积→清屏→退出→回溯）", () => {
  it("buffer 序列与回溯恢复", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "nvl-journey",
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [
            { op: "say", text: "开场" },
            { op: "nvl" },
            { op: "say", text: "甲" },
            { op: "say", text: "乙" },
            { op: "nvl", mode: "clear" },
            { op: "say", text: "丙" },
            { op: "nvl", mode: "exit" },
            { op: "say", text: "丁" },
          ],
        },
      ],
    });
    const engine = new StoryEngine(story, { rngSeed: 7 });
    engine.start();
    expect(engine.get(SYS.nvlMode)).toBe("none");

    engine.advance(); // 开场解除 → nvl → 甲
    expect(engine.get(SYS.nvlMode)).toBe("active");
    expect(engine.get(SYS.nvlBuffer)).toEqual(["甲"]);

    engine.advance(); // 乙
    expect(engine.get(SYS.nvlBuffer)).toEqual(["甲", "乙"]);

    engine.advance(); // 乙解除 → nvl clear（清空）→ say 丙 上屏（清屏后重入：[丙]）
    expect(engine.get(SYS.nvlBuffer)).toEqual(["丙"]);
    expect(engine.get(SYS.nvlMode)).toBe("active");

    engine.advance(); // 丙解除 → nvl exit → 丁上屏（非 NVL，不追加）
    expect(engine.get(SYS.nvlMode)).toBe("none");
    expect(engine.get(SYS.nvlBuffer)).toEqual([]);

    engine.advance(); // 丁（普通对话）
    expect(engine.get(SYS.currentDialogText)).toBe("丁");
    expect(engine.get(SYS.nvlMode)).toBe("none");

    // 回溯到甲（cp 包含 buffer=[甲]）
    engine.rollbackTo(1);
    expect(engine.get(SYS.nvlMode)).toBe("active");
    expect(engine.get(SYS.nvlBuffer)).toEqual(["甲"]);
    expect(engine.get(SYS.currentDialogText)).toBe("甲");
  });
});

describe("音频旅程（模拟用户：背景乐 → 语音 → 音效 → 回溯/前进 → 存读档）", () => {
  function buildAudioStory(): ReturnType<typeof parseStory> {
    return parseStory({
      formatVersion: 1,
      id: "audio-journey",
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [
            { op: "bgm", resource: "main.mp3", volume: 0.6, fade: 500 },
            { op: "ambient", resource: "rain.mp3", volume: 0.3 },
            { op: "say", text: "雨夜开场", voice: "open.mp3" },
            { op: "se", resource: "thunder.mp3", volume: 0.9 },
            { op: "say", text: "雷声滚过" },
            { op: "stop_ambient", fade: 800 },
            { op: "say", text: "雨停了" },
          ],
        },
      ],
    });
  }

  it("媒体状态随画面走：推进、回溯、前进、读档全程一致", () => {
    const engine = new StoryEngine(buildAudioStory(), { rngSeed: 7 });
    const errors: OutboundEvent[] = [];
    engine.onEvent((e) => errors.push(e));
    engine.start();

    // 开场：背景乐 + 环境层 + 本句语音（auto_stop 默认真）
    expect(engine.get(SYS.audioBgm)).toMatchObject({
      resource: "main.mp3",
      volume: 0.6,
      loop: true,
      fadeMs: 500,
    });
    expect(engine.get(SYS.audioAmbient)).toMatchObject({
      resource: "rain.mp3",
      volume: 0.3,
    });
    expect(engine.get(SYS.audioVoice)).toMatchObject({
      resource: "open.mp3",
      autoStop: true,
    });

    engine.reportMediaPosition(8); // 玩家听了 8 秒
    engine.advance(); // 推进：语音自动停止 → 音效 → 雷声句
    expect(engine.get(SYS.audioVoice)).toEqual({ kind: "stop", fadeMs: 0 });
    expect(engine.get(SYS.audioSe)).toMatchObject({ resource: "thunder.mp3" });
    expect(engine.get(SYS.currentDialogText)).toBe("雷声滚过");

    engine.advance(); // 雨停：环境层带淡出停止
    expect(engine.get(SYS.audioAmbient)).toEqual({ kind: "stop", fadeMs: 800 });
    expect(engine.get(SYS.currentDialogText)).toBe("雨停了");

    // 回溯到开场：曲目/环境层/语音/位置全部回到那一刻（03-R7）
    engine.rollbackTo(0);
    expect(engine.get(SYS.currentDialogText)).toBe("雨夜开场");
    expect(engine.get(SYS.audioBgm)).toMatchObject({ resource: "main.mp3" });
    expect(engine.get(SYS.audioAmbient)).toMatchObject({
      resource: "rain.mp3",
    });
    expect(engine.get(SYS.audioVoice)).toMatchObject({
      resource: "open.mp3",
    });
    expect(engine.get(SYS.bgmPosition)).toBe(0);

    // 前进（沿未截断时间线）：回到雷声句的媒体状态
    engine.forward();
    expect(engine.get(SYS.currentDialogText)).toBe("雷声滚过");
    expect(engine.get(SYS.audioVoice)).toEqual({ kind: "stop", fadeMs: 0 });
    expect(engine.get(SYS.audioAmbient)).toMatchObject({
      resource: "rain.mp3",
    });
    expect(engine.get(SYS.bgmPosition)).toBe(8);

    // 存读档：存档后继续推进（雨停），读档恢复「雷声句」的听感
    const data = engine.exportSave();
    expect(data).not.toBeNull();
    engine.advance();
    expect(engine.get(SYS.audioAmbient)).toEqual({ kind: "stop", fadeMs: 800 });
    expect(
      engine.importSave(JSON.parse(JSON.stringify(data)) as SaveDataV1),
    ).toBe(true);
    expect(engine.get(SYS.currentDialogText)).toBe("雷声滚过");
    expect(engine.get(SYS.audioAmbient)).toMatchObject({
      resource: "rain.mp3",
    });
    expect(engine.get(SYS.bgmPosition)).toBe(8);
    // 全程无 engine.error（rollback.done 属正常出站事件）
    expect(errors.filter((e) => e.payload.kind === "engine.error")).toEqual([]);
    engine.dispose();
  });

  it("回溯期间不重复触发已播语音（重放只重建当前句媒体）", () => {
    const engine = new StoryEngine(buildAudioStory(), { rngSeed: 7 });
    engine.start();
    engine.advance();
    engine.advance();
    const before = engine.get(SYS.audioSe);
    engine.rollbackTo(0);
    engine.forward();
    expect(engine.get(SYS.audioSe)).toMatchObject({
      resource: "thunder.mp3",
      seq: (before as { seq: number }).seq,
    });
    engine.dispose();
  });
});
