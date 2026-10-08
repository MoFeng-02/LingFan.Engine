/**
 * 等待声明表 ↔ 运行时行为互锁（锚点：等待表即事实源）
 *
 * `WAITING_OPS` 是静态消费者（编辑器步骤视图等）判定「步骤边界」的唯一依据，
 * 一旦它与运行时的真实等待行为漂移，步骤视图就会说谎。本文件用**行为**（真引擎跑一遍、
 * 读 `SYS.waiting`）而非脆弱的源级 grep 锁住二者一致；再加一张**分类完备账**
 * （内建 op 全集必须被划入「等待」或「非等待」，新增 op 未归类即红）防漏网。
 */
import { describe, expect, it } from "vitest";
import type { OutboundEvent } from "@lingfan/engine";
import {
  BUILTIN_OP_NAMES,
  SYS,
  StoryEngine,
  waitSpecOfOp,
  WAITING_OPS,
  waitingStateOfOp,
  parseStory,
} from "@lingfan/engine";

/** 造引擎：首列放待测命令（可按需补后续命令），需要目标列的用例自行构造列 */
function engineOf(commands: object[], extraColumns: object[] = []): StoryEngine {
  const json: unknown = {
    formatVersion: 1,
    id: "waiting-probe",
    columns: [
      { id: "start", kind: "flow", commands },
      ...extraColumns,
    ],
  };
  return new StoryEngine(parseStory(json));
}

function errorsOf(engine: StoryEngine): OutboundEvent[] {
  const errors: OutboundEvent[] = [];
  engine.onEvent((e) => {
    if (e.payload.kind === "engine.error") errors.push(e);
  });
  return errors;
}

/** 表里每个等待 op 的最小合法负载（键 = op，值 = 命令对象） */
const MINIMAL_PROBES: Record<string, object> = {
  say: { op: "say", text: "甲" },
  menu: {
    op: "menu",
    prompt: "去哪",
    options: [{ text: "酒馆", target: "inn" }],
  },
  wait: { op: "wait", seconds: 30 },
  pause: { op: "pause", seconds: 30 },
  input: { op: "input", prompt: "名字", store: "name" },
  cutscene: { op: "cutscene", resource: "Video/m1.mp4" },
  minigame: { op: "minigame", game: "coin" },
  interaction: { op: "interaction", system: "walk" },
};

/** 等待 op 进入等待所需的额外列（menu 的选项目标必须在场，否则 fail-closed 报 unknown-column） */
const PROBE_COLUMNS: Record<string, object[]> = {
  menu: [{ id: "inn", kind: "flow", commands: [{ op: "say", text: "酒馆线" }] }],
};

describe("行为正例：表里每个 op 跑一遍，等待态必须与声明一致", () => {
  for (const [op, spec] of WAITING_OPS) {
    it(`${op} → ${spec.state}`, () => {
      const probe = MINIMAL_PROBES[op];
      expect(probe, `缺 ${op} 的最小负载夹具`).toBeDefined();
      const engine = engineOf([probe!], PROBE_COLUMNS[op] ?? []);
      const errors = errorsOf(engine);
      try {
        engine.start();
        expect(errors.map((e) => JSON.stringify(e.payload))).toEqual([]);
        expect(engine.get(SYS.waiting)).toBe(spec.state);
        // 表的取值函数与表本体一致（静态消费者的实际入口）
        expect(waitingStateOfOp(op)).toBe(spec.state);
        expect(waitSpecOfOp(op)).toEqual(spec);
      } finally {
        engine.dispose(); // 停掉 wait/pause 的长定时器（不用 fake timers——那会掩盖等待态时序）
      }
    });
  }
});

describe("行为反例：不建立等待的 op 跑完必须不出等待态", () => {
  // 含 stream 上常见的「看着像会阻塞」但实际非阻塞者（video 非阻塞播放、jump/navigate 控制转移）
  const NON_WAITING_PROBES: Record<string, object> = {
    set: { op: "set", key: "n", value: 1 },
    notify: { op: "notify", text: "提示" },
    nvl: { op: "nvl", mode: "active" },
    video: { op: "video", resource: "Video/m1.mp4" },
    jump: { op: "jump", target: "tail" },
    navigate: { op: "navigate", path: "tail" },
  };

  for (const [op, probe] of Object.entries(NON_WAITING_PROBES)) {
    it(`${op} → none（且不报错）`, () => {
      const engine = engineOf(
        // 尾巴补一句 say：该 op 不自建等待，则执行流应继续推进并停在 say 的 dialog 等待上
        [probe, { op: "say", text: "尾" }],
        [{ id: "tail", kind: "flow", commands: [{ op: "say", text: "落点" }] }],
      );
      const errors = errorsOf(engine);
      try {
        engine.start();
        expect(errors.map((e) => JSON.stringify(e.payload))).toEqual([]);
        // 停在尾句的对话等待 = 该 op 自身没有建立等待（否则会停在自己那一步）
        expect(engine.get(SYS.waiting)).toBe("dialog");
        expect(waitingStateOfOp(op)).toBe("none");
        expect(waitSpecOfOp(op)).toBeUndefined();
      } finally {
        engine.dispose();
      }
    });
  }
});

describe("分类完备账：内建 op 全集必须被显式划分为等待 / 非等待（新增 op 未归类即红）", () => {
  /** 非等待 op 清单：显式列出，作为「新增 op 必须归类」的护栏（不是运行时的第二份定义——
   *  运行时的真相由上面两组行为用例与分发 switch 持有；这里只是**分类账**，防止新 op 漏归类） */
  const NON_WAITING_OPS: readonly string[] = [
    "jump",
    "navigate",
    "save",
    "load",
    "auto_save",
    "save_delete",
    "if",
    "while",
    "for",
    "foreach",
    "switch",
    "break",
    "continue",
    "assert",
    "guard",
    "set",
    "let",
    "local",
    "define",
    "undef",
    "func",
    "call",
    "return",
    "array",
    "array_push",
    "array_pop",
    "dict",
    "dict_set",
    "notify",
    "random",
    "nvl",
    "character",
    "bgm",
    "se",
    "ambient",
    "stop_bgm",
    "stop_ambient",
    "voice",
    "stop_voice",
    "video",
    "seek_video",
    "pause_video",
    "resume_video",
    "stop_video",
    "video_skipable",
    "show",
    "hide",
    "background",
    "bg_switch",
    "zindex",
    "style",
    "window",
    "animate",
    "animate_block",
    "transition",
    "shake",
    "text_typewriter",
  ];

  it("等待表 + 非等待清单 = 内建 op 全集（无重、无漏、无越界）", () => {
    const classified = [...WAITING_OPS.keys(), ...NON_WAITING_OPS];
    expect(new Set(classified).size).toBe(classified.length); // 无重复归类
    expect([...classified].sort()).toEqual([...BUILTIN_OP_NAMES].sort());
  });

  it("等待表里的每个 op 都必须有最小负载夹具（防「表加了 op、行为没验」）", () => {
    for (const op of WAITING_OPS.keys()) {
      expect(MINIMAL_PROBES[op], `${op} 缺最小负载夹具`).toBeDefined();
    }
    expect(Object.keys(MINIMAL_PROBES).sort()).toEqual(
      [...WAITING_OPS.keys()].sort(),
    );
  });
});

describe("取值函数边界", () => {
  it("未知 op / 扩展 op / 非字符串 → none（扩展 op 执行成功即步进，不建立等待态）", () => {
    expect(waitingStateOfOp("ext.demo.custom")).toBe("none");
    expect(waitingStateOfOp("no-such-op")).toBe("none");
    expect(waitingStateOfOp(undefined)).toBe("none");
    expect(waitingStateOfOp(42)).toBe("none");
    expect(waitSpecOfOp(42)).toBeUndefined();
  });

  it("pause 与 wait 同等待态但硬等待标记不同（展示层据此区分「不可跳过」）", () => {
    expect(waitingStateOfOp("wait")).toBe("wait");
    expect(waitingStateOfOp("pause")).toBe("wait");
    expect(waitSpecOfOp("wait")?.hard).toBeUndefined();
    expect(waitSpecOfOp("pause")?.hard).toBe(true);
  });
});