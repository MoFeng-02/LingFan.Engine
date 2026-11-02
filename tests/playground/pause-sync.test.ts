/**
 * 引擎暂停态回写宿主页面这一跳的护栏。
 *
 * 链路上有四段，任何一段断掉都会让「挂载 UI 点了暂停、遮罩却不出来」：
 * ① 引擎把 `SYS.paused` 的变化报给 `onPaused`；
 * ② 生命周期总装把 `onPaused` 接到一个可换的目标 `pausedSink`；
 * ③ 会话装配完成后，目标换成会话的 `syncPaused`；
 * ④ `syncPaused` 在**已进对局**时把值落到页面态 `paused`。
 *
 * 前两段与第三段的接线顺序是源码级契约（总装要造引擎与帧循环，跑不起纯单测），
 * 这里按 `host-wiring.test.ts` 的既有范式用 `?raw` 扫源；第四段是纯函数行为，直接跑。
 * 分开写是因为它们红的方式不同：接线断了是「改了没同步」，语义错了是「同步了判错」。
 */
import { describe, expect, it } from "vitest";
import appEngineSource from "../../apps/playground/src/host/engine/app-engine.ts?raw";
import appLifecycleSource from "../../apps/playground/src/host/session/wiring/app-lifecycle.ts?raw";
import { createAppSession } from "../../apps/playground/src/host/session/app-session";

/** 换行符的字符码：扫描器要按行切，直接写转义会被它自己数错。 */
const NEWLINE = String.fromCharCode(10);

/**
 * 只剥注释、保留字符串字面量：判据要看的是**代码**，而注释里同样会写着判据串
 * （解释某行为什么这么接时几乎必然提到它）。不剥注释的 `toContain` 在接线被
 * 注释掉之后依然成立——那是假绿，正是这里要防的。
 */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source.charAt(i);
    const next = i + 1 < source.length ? source.charAt(i + 1) : "";
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      out += " ";
      continue;
    }
    if (ch === "/" && next === "/") {
      const end = source.indexOf(NEWLINE, i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < source.length && source.charAt(i) !== quote) {
        out += source.charAt(i);
        i += 1;
      }
      if (i < source.length) out += quote;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** 造一份最小会话：只关心页面态，端口与动作全是空实现 */
function createSession(): ReturnType<typeof createAppSession> {
  return createAppSession({
    controls: {
      pause: () => undefined,
      resume: () => undefined,
      paused: () => false,
      pauseMedia: () => undefined,
      resumeMedia: () => undefined,
      navigate: () => undefined,
      save: () => undefined,
      load: () => undefined,
      dispose: () => undefined,
    },
    mounts: { snapshot: () => undefined, subscribe: () => () => undefined },
    mountsTable: {},
    saves: {
      slots: 2,
      thumbnail: { width: 1, height: 1, quality: 1, showText: false },
    },
    savePort: {
      write: () => Promise.resolve(),
      read: () => Promise.resolve(""),
      remove: () => Promise.resolve(),
      list: () => Promise.resolve([]),
    },
    enterGame: () => undefined,
    continueGame: () => undefined,
    advance: () => undefined,
    applyStageFit: () => undefined,
  });
}

const engineCode = stripComments(appEngineSource);
const lifecycleCode = stripComments(appLifecycleSource);

describe("引擎暂停态回写页面（四个段落缺一即断）", () => {
  it("剥注释这一步本身可信：注释里的判据串不算数，字符串里的原文算数", () => {
    expect(stripComments("/* onPaused(x) */ real();")).not.toContain(
      "onPaused",
    );
    expect(stripComments("/* onPaused(x) */ real();")).toContain("real();");
    expect(stripComments('const note = "onPaused(x)";')).toContain(
      "onPaused(x)",
    );
  });

  it("引擎只认 `SYS.paused` 这一个键：订阅时先喂当前值，变化就报", () => {
    expect(engineCode).toContain("onPaused(e.get(SYS.paused) === true);");
    expect(engineCode).toContain(
      "if (key === SYS.paused) onPaused(value === true);",
    );
  });

  it("总装把 onPaused 接到可换目标（引擎可能早于会话装配就报暂停态）", () => {
    expect(lifecycleCode).toContain(
      "onPaused: (value: boolean) => pausedSink.apply?.(value),",
    );
    expect(lifecycleCode).toContain("const pausedSink: { apply?:");
  });

  it("会话装配完成后才接上落点（顺序反了会把首批暂停态丢掉）", () => {
    const sessionAt = lifecycleCode.indexOf(
      "const session = createAppSession({",
    );
    const sinkAt = lifecycleCode.indexOf(
      "pausedSink.apply = session.syncPaused;",
    );
    expect(sessionAt, "总装里找不到会话装配").toBeGreaterThan(-1);
    expect(sinkAt, "总装里找不到暂停态落点接线").toBeGreaterThan(-1);
    expect(sinkAt, "落点接线必须晚于会话装配").toBeGreaterThan(sessionAt);
  });

  it("已进对局时引擎报什么就落什么：页面态不从「是哪个按钮按的」推断", () => {
    const session = createSession();
    session.inGame.value = true;
    session.syncPaused(true);
    expect(session.paused.value).toBe(true);
    session.syncPaused(false);
    expect(session.paused.value).toBe(false);
  });

  it("未进对局时的暂停报价被丢弃（没有遮罩可同步，也不留假状态）", () => {
    const session = createSession();
    session.syncPaused(true);
    expect(session.inGame.value).toBe(false);
    expect(session.paused.value).toBe(false);
  });

  it("回到标题后引擎侧的暂停报价不再改页面态（引擎留着，舞台已卸）", () => {
    const session = createSession();
    session.inGame.value = true;
    session.syncPaused(true);
    session.inGame.value = false;
    session.paused.value = false;
    session.syncPaused(true);
    expect(session.paused.value).toBe(false);
  });
});
