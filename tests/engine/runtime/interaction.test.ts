/**
 * `interaction` op（外部玩法系统接管）测试。
 *
 * 语义与 `minigame` 逐条对齐（不新造等待语义）：
 * - 建立等待（`__waiting = "interaction"`）+ 提交检查点 + auto_save 消费点
 * - 出站 `interaction.mount`（携 system / config / AbortSignal / seq）
 * - 宿主 `resolveInteraction` 回填 → 分流 on_success / on_fail → 继续执行
 * - 回溯 / 导航 / 读档 / 销毁 ⇒ abort 信号（宿主卸载），重放 = 重新挂载（新 seq 新 signal）
 *
 * 故意错误：非等待期 resolve / 系统标识不符 / 畸形结果 / 坏负载 / 非法系统标识。
 */
import { describe, expect, it, vi } from "vitest";
import type { OutboundEvent } from "@lingfan/engine";
import { SYS, StoryEngine, parseStory } from "@lingfan/engine";

function makeEngine(
  entry: object[],
  extra: object[] = [{ op: "say", text: "落点" }],
): { engine: StoryEngine; errors: OutboundEvent[]; events: OutboundEvent[] } {
  const engine = new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "demo",
      columns: [
        { id: "s", kind: "flow", commands: [...entry, ...extra] },
        { id: "ok", kind: "flow", commands: [{ op: "say", text: "成功分支" }] },
        { id: "ng", kind: "flow", commands: [{ op: "say", text: "失败分支" }] },
      ],
    }),
  );
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

function mountPayload(events: OutboundEvent[]) {
  const hit = events.find((e) => e.payload.kind === "interaction.mount");
  return hit?.payload.kind === "interaction.mount" ? hit.payload : undefined;
}

describe("interaction · 建立等待与挂载事件", () => {
  it("建立 interaction 等待并出站挂载事件（携 system/config/signal/seq）", () => {
    const { engine, events } = makeEngine([
      { op: "interaction", system: "walk", config: { target: 100 } },
    ]);
    expect(engine.get(SYS.waiting)).toBe("interaction");
    const payload = mountPayload(events);
    expect(payload).toBeDefined();
    expect(payload!.system).toBe("walk");
    expect(payload!.config).toEqual({ target: 100 });
    expect(payload!.seq).toBe(1);
    expect(payload!.signal.aborted).toBe(false);
    // 挂载信息进 SSOT（随快照；signal 不进）
    expect(engine.get(SYS.interaction)).toEqual({
      system: "walk",
      config: { target: 100 },
      seq: 1,
    });
  });

  it("等待建立即提交检查点（与 menu/wait/input/minigame 同语义）", () => {
    const { engine } = makeEngine([
      { op: "interaction", system: "walk" },
    ]);
    expect(engine.historyCursor()).toBeGreaterThanOrEqual(0);
  });

  it("config 缺省 = 空对象（宿主拿到稳定形状）", () => {
    const { engine, events } = makeEngine([{ op: "interaction", system: "walk" }]);
    expect(engine.get(SYS.waiting)).toBe("interaction");
    expect(mountPayload(events)!.config).toEqual({});
  });
});

describe("interaction · resolveInteraction 分流", () => {
  it("success → on_success 分流；state 落本系统命名空间", () => {
    const { engine, events } = makeEngine([
      {
        op: "interaction",
        system: "walk",
        on_success: "ok",
        on_fail: "ng",
      },
      { op: "say", text: "不应到这里" },
    ]);
    const payload = mountPayload(events)!;
    expect(
      engine.resolveInteraction("walk", {
        outcome: "success",
        state: { arrived: true, x: 100 },
      }),
    ).toBe(true);
    // 已离开 interaction 等待（分流列自身的 say 建立新的 dialog 等待）
    expect(engine.get(SYS.waiting)).not.toBe("interaction");
    // state 自动落 game.walk.* 前缀（外部系统不必自己拼）
    expect(engine.get("game.walk.arrived")).toBe(true);
    expect(engine.get("game.walk.x")).toBe(100);
    // 分流到 on_success 列
    expect(engine.get(SYS.currentDialogText)).toContain("成功分支");
    expect(payload.signal.aborted).toBe(false); // 正常完成不 abort
  });

  it("fail → on_fail 分流", () => {
    const { engine, events } = makeEngine([
      { op: "interaction", system: "walk", on_success: "ok", on_fail: "ng" },
    ]);
    mountPayload(events);
    expect(engine.resolveInteraction("walk", { outcome: "fail" })).toBe(true);
    expect(engine.get(SYS.currentDialogText)).toContain("失败分支");
  });

  it("分流目标缺省 = 原列继续（不跳列）", () => {
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "demo",
        columns: [
          {
            id: "s",
            kind: "flow",
            commands: [
              { op: "interaction", system: "walk" },
              { op: "say", text: "接管之后" },
            ],
          },
        ],
      }),
    );
    engine.start();
    expect(engine.resolveInteraction("walk", { outcome: "success" })).toBe(true);
    expect(engine.get(SYS.currentDialogText)).toContain("接管之后");
  });

  it("score 有限数校验（畸形拒绝）", () => {
    const { engine, events } = makeEngine([{ op: "interaction", system: "walk" }]);
    mountPayload(events);
    expect(
      engine.resolveInteraction("walk", { outcome: "success", score: Number.NaN }),
    ).toBe(false);
    expect(engine.get(SYS.waiting)).toBe("interaction"); // 仍在等待
  });
});

describe("interaction · 故意错误（fail-closed）", () => {
  it("非等待期 resolve 拒绝", () => {
    const { engine, errors } = makeEngine([{ op: "say", text: "无接管" }]);
    expect(engine.resolveInteraction("walk", { outcome: "success" })).toBe(false);
    expect(errorCodes(errors)).toContain("interaction-resolve-invalid");
  });

  it("系统标识不符拒绝（防串系统回填）", () => {
    const { engine, errors, events } = makeEngine([
      { op: "interaction", system: "walk" },
    ]);
    mountPayload(events);
    expect(engine.resolveInteraction("battle", { outcome: "success" })).toBe(false);
    expect(errorCodes(errors)).toContain("interaction-system-mismatch");
    expect(engine.get(SYS.waiting)).toBe("interaction");
  });

  it("畸形结果（缺 outcome / 非法 outcome / null）拒绝", () => {
    const { engine, events } = makeEngine([{ op: "interaction", system: "walk" }]);
    mountPayload(events);
    for (const bad of [null, {}, { outcome: "maybe" }, "success"]) {
      expect(
        engine.resolveInteraction("walk", bad as never),
        `${JSON.stringify(bad)} 应被拒绝`,
      ).toBe(false);
    }
    expect(engine.get(SYS.waiting)).toBe("interaction");
  });

  it("非法系统标识（负载级）拒绝且不建立等待", () => {
    const cases = ["", "Walk", "带中文", "../etc", "1abc"];
    for (const system of cases) {
      const engine = new StoryEngine(
        parseStory({
          formatVersion: 1,
          id: "demo",
          columns: [
            { id: "s", kind: "flow", commands: [{ op: "interaction", system }] },
          ],
        }),
      );
      const errors: OutboundEvent[] = [];
      engine.onEvent((e) => errors.push(e));
      engine.start();
      // 拒绝后停在当前命令、不建立等待：脚本跑完无等待 ⇒ __waiting 从未被写入（undefined）
      expect(engine.get(SYS.waiting), `${system} 不应建立等待`).not.toBe(
        "interaction",
      );
      expect(errorCodes(errors)).toContain("interaction-invalid");
    }
  });

  it("未知负载字段拒绝（fail-closed 不静默忽略）", () => {
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "demo",
        columns: [
          {
            id: "s",
            kind: "flow",
            commands: [{ op: "interaction", system: "walk", bonus: 1 }],
          },
        ],
      }),
    );
    const errors: OutboundEvent[] = [];
    engine.onEvent((e) => errors.push(e));
    engine.start();
    expect(errorCodes(errors)).toContain("interaction-unknown-field");
    expect(engine.get(SYS.waiting)).not.toBe("interaction");
  });

  it("state 非对象拒绝（不污染命名空间）", () => {
    const { engine, errors, events } = makeEngine([
      { op: "interaction", system: "walk" },
    ]);
    mountPayload(events);
    expect(
      engine.resolveInteraction("walk", {
        outcome: "success",
        state: [1, 2] as never,
      }),
    ).toBe(false);
    expect(errorCodes(errors)).toContain("interaction-result-invalid");
  });
});

describe("interaction · 中断与重放（回溯一致性）", () => {
  it("回溯打断：abort 挂载信号（宿主据此卸载）", () => {
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "demo",
        columns: [
          {
            id: "s",
            kind: "flow",
            commands: [
              { op: "say", text: "第一句" },
              { op: "say", text: "第二句" },
              { op: "interaction", system: "walk" },
            ],
          },
        ],
      }),
    );
    const events: OutboundEvent[] = [];
    engine.onEvent((e) => events.push(e));
    engine.start();
    engine.advance(); // 第一句提交检查点
    engine.advance(); // 第二句提交检查点
    const payload = mountPayload(events);
    expect(payload, "应已挂载").toBeDefined();
    const onAbort = vi.fn();
    // 契约只承诺 `aborted` 可轮询；订阅中止事件时收窄回本运行环境的中止类型
    (payload!.signal as AbortSignal).addEventListener("abort", onAbort);
    engine.back();
    expect(onAbort).toHaveBeenCalled();
    expect(payload!.signal.aborted).toBe(true);
  });

  it("navigate 打断：abort 挂载信号", () => {
    const { engine, events } = makeEngine([{ op: "interaction", system: "walk" }]);
    const payload = mountPayload(events)!;
    engine.navigate("ok");
    expect(payload.signal.aborted).toBe(true);
  });

  it("读档打断：abort 挂载信号", () => {
    const { engine, events } = makeEngine([
      { op: "say", text: "存档点" },
      { op: "interaction", system: "walk" },
    ]);
    engine.advance();
    const save = engine.exportSave();
    expect(save).not.toBeNull();
    const payload = mountPayload(events)!;
    engine.importSave(save!);
    expect(payload.signal.aborted).toBe(true);
  });

  it("重放重新挂载 = 新 seq 新 signal（与旧挂载可分辨）", () => {
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "demo",
        columns: [
          {
            id: "s",
            kind: "flow",
            commands: [
              { op: "say", text: "第一句" },
              { op: "say", text: "第二句" },
              { op: "interaction", system: "walk" },
            ],
          },
        ],
      }),
    );
    const events: OutboundEvent[] = [];
    engine.onEvent((e) => events.push(e));
    engine.start();
    engine.advance();
    engine.advance();
    const first = mountPayload(events)!;
    engine.back(); // 回溯：abort 旧挂载
    engine.back();
    engine.forward(); // 前进：重放经过 interaction ⇒ 重新挂载
    engine.forward();
    const mounts = events.filter((e) => e.payload.kind === "interaction.mount");
    expect(mounts.length).toBeGreaterThanOrEqual(2);
    const latest = mounts.at(-1)!.payload;
    expect(latest.kind === "interaction.mount" && latest.seq).not.toBe(first.seq);
    expect(latest.kind === "interaction.mount" && latest.signal).not.toBe(
      first.signal,
    );
  });

  it("dispose 打断：abort 挂载信号", () => {
    const { engine, events } = makeEngine([{ op: "interaction", system: "walk" }]);
    const payload = mountPayload(events)!;
    engine.dispose();
    expect(payload.signal.aborted).toBe(true);
  });

  it("读档恢复后仍是 interaction 等待（等待态随档）", () => {
    const { engine } = makeEngine([
      { op: "say", text: "存档点" },
      { op: "interaction", system: "walk" },
    ]);
    engine.advance();
    const save = engine.exportSave()!;
    engine.importSave(save);
    expect(engine.get(SYS.waiting)).toBe("interaction");
  });
});
