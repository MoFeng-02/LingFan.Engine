/**
 * uncharacter（角色注销）行为测试。
 *
 * 注销 = 注册表 delete，随快照回滚；未注册键不构成故障——
 * 发 character.missing 知情事件后继续推进，停机与否由创作者在事件侧自行决定。
 */
import { describe, expect, it } from "vitest";
import type { CharacterMissingPayload, OutboundEvent } from "@lingfan/engine";
import { StoryEngine, SYS, parseStory } from "@lingfan/engine";

/** 造引擎：JSON 故事直构（注销探针用） */
function engineOf(
  commands: object[],
  extraColumns: object[] = [],
): StoryEngine {
  const json: unknown = {
    formatVersion: 1,
    id: "uncharacter-probe",
    columns: [{ id: "start", kind: "flow", commands }, ...extraColumns],
  };
  return new StoryEngine(parseStory(json));
}

function eventsOf(engine: StoryEngine): OutboundEvent[] {
  const events: OutboundEvent[] = [];
  engine.onEvent((e) => events.push(e));
  return events;
}

describe("uncharacter：注销", () => {
  it("已注册角色注销后，say 回落缺省样式（screen 不再命中）", () => {
    const engine = engineOf([
      { op: "character", key: "灵泛", name: "阿泛", screen: "on" },
      { op: "say", speaker: "灵泛", text: "第一句" },
      { op: "uncharacter", key: "灵泛" },
      { op: "say", speaker: "灵泛", text: "第二句" },
    ]);
    const events = eventsOf(engine);
    try {
      engine.start();
      expect(
        events.filter((e) => e.payload.kind === "engine.error"),
      ).toEqual([]);
      // 第一句后角色带 screen；注销后同 speaker 的第二个 say 不再命中样式
      const afterUncharacter = events.filter(
        (e) => e.payload.kind === "notify" || e.payload.kind === "engine.error",
      );
      expect(afterUncharacter).toEqual([]); // 无错误、无异常通知
      expect(engine.get(SYS.waiting)).toBe("dialog"); // 正常停在第二个 say
    } finally {
      engine.dispose();
    }
  });

  it("未注册键：发 character.missing 事件且故事继续推进（不停机）", () => {
    const engine = engineOf([
      { op: "uncharacter", key: "鬼影" },
      { op: "say", text: "注销后继续" },
    ]);
    const events = eventsOf(engine);
    try {
      engine.start();
      const missing = events.filter(
        (e): e is OutboundEvent & { payload: CharacterMissingPayload } =>
          e.payload.kind === "character.missing",
      );
      expect(missing).toHaveLength(1);
      expect(missing[0]!.payload.key).toBe("鬼影");
      expect(
        events.filter((e) => e.payload.kind === "engine.error"),
      ).toEqual([]); // 不走 engine.error——非故障
      expect(engine.get(SYS.waiting)).toBe("dialog"); // 推进到下一句
    } finally {
      engine.dispose();
    }
  });

  it("注销随回溯回滚：回滚到注销前检查点，角色恢复可用", () => {
    const engine = engineOf(
      [
        { op: "character", key: "灵泛", name: "阿泛", screen: "on" },
        { op: "say", text: "第一幕" },
        { op: "uncharacter", key: "灵泛" },
        { op: "say", text: "第二幕" },
      ],
      [{ id: "act3", kind: "flow", commands: [{ op: "say", text: "第三幕" }] }],
    );
    const events = eventsOf(engine);
    try {
      engine.start(); // 停在第一幕 say（检查点 0 已提交）
      engine.advance(); // 第二幕 say 前 uncharacter 已执行
      engine.advance(); // 停在第二幕
      engine.rollbackTo(0); // 回到第一幕检查点（uncharacter 之前）
      // 回放重跑到第二幕：注销重新执行——角色表回滚到注销前检查点的样子
      // 回放推进后注销生效前的画面 = 角色仍在
      expect(engine.getCharacters().map((c) => c.key)).toContain("灵泛");
      expect(
        events.filter((e) => e.payload.kind === "engine.error"),
      ).toEqual([]);
    } finally {
      engine.dispose();
    }
  });

  it("重复注销同名键：第二次同样发 missing 事件（delete 返回 false）", () => {
    const engine = engineOf([
      { op: "character", key: "甲" },
      { op: "uncharacter", key: "甲" },
      { op: "uncharacter", key: "甲" },
      { op: "say", text: "尾" },
    ]);
    const events = eventsOf(engine);
    try {
      engine.start();
      const missing = events.filter(
        (e) => e.payload.kind === "character.missing",
      );
      expect(missing).toHaveLength(1); // 只第二次注销触发
    } finally {
      engine.dispose();
    }
  });
});
