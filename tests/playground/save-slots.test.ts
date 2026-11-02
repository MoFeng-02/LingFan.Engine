/**
 * 会话快照上的存档槽位面：快捷槽从哪来、「继续」读哪一槽、空槽挡在哪。
 *
 * 挑选规则（按 `timestamp` 取最大、只认配置内的槽）在 `save-list.test.ts` 里守；
 * 这里守的是**它接到会话上的那一段**——三者各自成立但接错，玩家看到的就是
 * 「存档点了没反应」「继续读了一个看不见的槽」「首启就弹错」。
 *
 * 四件事：
 * ① 快捷槽是 `slotIds(saves.slots)[0]`，不是写死的 `"slot_1"`（改槽位数要跟着走）；
 * ② 「继续」的槽必须经 `slotIds` 过滤，历史遗留槽再新也不选；
 * ③ 读摘要失败与无档同一条路：清空、不抛、不留假槽名；
 * ④ 空槽名一律不动作——按钮的 `disabled` 是给人看的，挡板要在动作这一侧。
 *
 * 会话是纯页面态，直接 `createAppSession` 造一个；操作通道用记录调用的替身，
 * 断言的是「有没有把动作交给引擎、交了什么」，不是引擎做了什么。
 */
import { describe, expect, it } from "vitest";
import type { HostControls, SlotSummary } from "@lingfan-engine/core";
import { createAppSession } from "../../apps/playground/src/host/session/app-session";

/** 操作通道替身：只记名字与参数，`paused()` 恒 false（本文件不测暂停语义） */
function createControls(): {
  controls: HostControls;
  calls: string[];
} {
  const calls: string[] = [];
  const controls: HostControls = {
    pause: () => calls.push("pause"),
    resume: () => calls.push("resume"),
    paused: () => false,
    pauseMedia: () => calls.push("pauseMedia"),
    resumeMedia: () => calls.push("resumeMedia"),
    navigate: (columnId) => calls.push(`navigate:${columnId}`),
    save: (slot) => calls.push(`save:${slot}`),
    load: (slot) => calls.push(`load:${slot}`),
    dispose: () => calls.push("dispose"),
  };
  return { controls, calls };
}

/** 造一条槽位摘要；时间戳显式给，好让「取最大」只可能靠它 */
function summary(slot: string, timestamp: number): SlotSummary {
  return { slot, saveCount: 1, timestamp, mode: "machine-bound" };
}

/** 装配入参：只关心存档面与两个宿主动作，其余给空实现 */
interface SessionInput {
  /** 工程配置的槽位数 */
  slots: number;
  /** `SavePort.list()` 的返回；`throwing` 为真时改为抛错 */
  summaries?: readonly SlotSummary[];
  throwing?: boolean;
}

/** 造最小会话：返回会话与两个记录数组（操作通道调用、进对局次数） */
function createSession(input: SessionInput): {
  session: ReturnType<typeof createAppSession>;
  calls: string[];
  entered: string[];
} {
  const { controls, calls } = createControls();
  const entered: string[] = [];
  const session = createAppSession({
    controls,
    mounts: { snapshot: () => undefined, subscribe: () => () => undefined },
    mountsTable: {},
    saves: {
      slots: input.slots,
      thumbnail: { width: 1, height: 1, quality: 1, showText: false },
    },
    savePort: {
      write: () => Promise.resolve(),
      read: () => Promise.resolve(""),
      remove: () => Promise.resolve(),
      list: () =>
        input.throwing === true
          ? Promise.reject(new Error("读档位失败"))
          : Promise.resolve([...(input.summaries ?? [])]),
    },
    enterGame: () => entered.push("enter"),
    continueGame: (slot) => entered.push(`continue:${slot}`),
    advance: () => entered.push("advance"),
    applyStageFit: () => entered.push("fit"),
  });
  return { session, calls, entered };
}

describe("会话快照的存档槽位面", () => {
  it("快捷槽跟着工程配置走：槽位数变了，存的还是第一个槽", () => {
    expect(createSession({ slots: 3 }).session.quickSlot.value).toBe("slot_1");
    expect(createSession({ slots: 8 }).session.quickSlot.value).toBe("slot_1");
    // 槽位数为 0 时没有槽可写：空串让暂停菜单的「保存」置灰
    expect(createSession({ slots: 0 }).session.quickSlot.value).toBe("");
  });

  it("还没读摘要时「继续」没有槽（首帧不是假槽名）", () => {
    expect(createSession({ slots: 3 }).session.resumeSlot.value).toBe("");
  });

  it("「继续」取最近写入的那一槽，与摘要返回顺序无关", async () => {
    const { session } = createSession({
      slots: 3,
      summaries: [
        summary("slot_2", 1_700_000_300_000),
        summary("slot_1", 1_700_000_100_000),
        summary("slot_3", 1_700_000_200_000),
      ],
    });
    await session.refreshResumeSlot();
    expect(session.resumeSlot.value).toBe("slot_2");
  });

  it("配置外的历史槽再新也不选（改过槽位数的工程）", async () => {
    const { session } = createSession({
      slots: 2,
      summaries: [
        summary("slot_6", 1_700_000_900_000),
        summary("slot_1", 1_700_000_100_000),
      ],
    });
    await session.refreshResumeSlot();
    expect(session.resumeSlot.value).toBe("slot_1");
  });

  it("无档与读失败同一条路：清空、不抛、不留旧值", async () => {
    const empty = createSession({ slots: 3, summaries: [] });
    await empty.session.refreshResumeSlot();
    expect(empty.session.resumeSlot.value).toBe("");

    const failing = createSession({ slots: 3, throwing: true });
    await expect(failing.session.refreshResumeSlot()).resolves.toBeUndefined();
    expect(failing.session.resumeSlot.value).toBe("");
  });

  it("已读到槽后再次失败要清掉旧槽（不能停在已删档上）", async () => {
    const ok = createSession({
      slots: 3,
      summaries: [summary("slot_1", 1_700_000_100_000)],
    });
    await ok.session.refreshResumeSlot();
    expect(ok.session.resumeSlot.value).toBe("slot_1");

    // 同一份会话再刷一次、这次端口抛错：旧槽必须被清掉而不是留着
    const broken = createSession({ slots: 3, throwing: true });
    broken.session.resumeSlot.value = "slot_1";
    await broken.session.refreshResumeSlot();
    expect(broken.session.resumeSlot.value).toBe("");
  });

  it("空槽名不动作：置灰是给人看的，挡板在动作这一侧", () => {
    const { session, calls, entered } = createSession({ slots: 3 });

    session.onSave("");
    session.onLoad("");
    session.onContinue("");
    expect(calls).toEqual([]);
    expect(entered).toEqual([]);
    expect(session.inGame.value).toBe(false);
  });

  it("存与读各自只带一个槽名过去，动作全经操作通道", () => {
    const { session, calls } = createSession({ slots: 3 });

    session.onSave("slot_2");
    session.onLoad("slot_3");
    expect(calls).toEqual(["save:slot_2", "load:slot_3"]);
  });

  it("读档后仍停在暂停态（什么时候继续由玩家决定）", async () => {
    const { session, calls } = createSession({ slots: 3 });
    session.inGame.value = true;
    session.syncPaused(true);

    session.onLoad("slot_1");
    expect(calls).toEqual(["load:slot_1"]);
    expect(session.paused.value).toBe(true);
  });

  it("「继续」先起引擎再按槽恢复，且顺带清掉暂停态", () => {
    const { session, entered } = createSession({ slots: 3 });
    session.paused.value = true;

    session.onContinue("slot_2");
    // 顺序是契约：命令面要求引擎已启动，故 enterGame 必须在前
    expect(entered).toEqual(["enter", "continue:slot_2"]);
    expect(session.inGame.value).toBe(true);
    expect(session.paused.value).toBe(false);
  });

  it("回到标题：引擎留着（仍暂停）、页面退回启动页、暂停态清掉", () => {
    const { session, calls } = createSession({ slots: 3 });
    session.inGame.value = true;
    session.paused.value = true;

    session.onHome();
    expect(calls).toEqual(["pause"]);
    expect(session.paused.value).toBe(false);
    expect(session.inGame.value).toBe(false);
  });
});
