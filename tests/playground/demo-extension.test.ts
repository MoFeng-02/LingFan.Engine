/**
 * 演示扩展 × 真引擎防腐旅程：playground 随包发布的 `extensions/demo-quest.ts` 必须被
 * 真实引擎装载、注册、执行——这是 T5「TS 管线 × 扩展 op 放行」全链路的**运行期锚**。
 * 模块漂移（op 改名 / exec 破坏）= 用户工程运行期 unknown-op，必须在这里红而不是玩家那里。
 *
 * 旅程四环：声明装载 → 执行进 SSOT（ext.<id>. 前缀）→ 存档依赖标记（带扩展恢复 /
 * 缺扩展整档拒绝）→ 未注册 fail-closed（unknown-op，不静默跑过）。
 */
import { describe, expect, it } from "vitest";
import { StoryEngine, type Story } from "@lingfan/engine";
import demoQuest from "../../apps/playground/extensions/demo-quest";

function questStory(): Story {
  return {
    formatVersion: 1,
    id: "ext-demo",
    entry: "a",
    columns: [
      {
        id: "a",
        kind: "flow",
        commands: [
          { op: "quest", step: "接取委托" },
          { op: "say", text: "进度：{ext.demoquest.step}" },
          { op: "quest", step: "完成交付" },
          { op: "say", text: "进度：{ext.demoquest.step}" },
        ],
      },
    ],
  };
}

describe("演示扩展防腐（demo-quest × 真引擎）", () => {
  it("声明装载 → quest 执行 → ext.<id>. 状态进 SSOT → 插值可见", () => {
    const engine = new StoryEngine(questStory(), { extensions: [demoQuest] });
    engine.start(); // quest#1 执行 → 停在 say（等待点）
    expect(engine.interpolate("进度：{ext.demoquest.step}")).toBe(
      "进度：接取委托",
    );
    engine.advance(); // say → quest#2 → say（等待点）
    expect(engine.interpolate("进度：{ext.demoquest.step}")).toBe(
      "进度：完成交付",
    );
    engine.dispose();
  });

  it("存档依赖标记：exportSave 记实际引用；带扩展读档恢复、缺扩展整档拒绝", () => {
    const engine = new StoryEngine(questStory(), { extensions: [demoQuest] });
    engine.start();
    const save = engine.exportSave();
    expect(save).not.toBeNull();
    // 标记 = {id, stateVersion} 对象（stateVersion 进存档校验，≠ 代码版本）
    expect(save?.extensions?.map((e) => e.id)).toEqual(["demoquest"]);

    // 带扩展读档 = 状态恢复（step 回到存档时刻的值）
    const withExt = new StoryEngine(questStory(), { extensions: [demoQuest] });
    expect(withExt.importSave(save!)).toBe(true);
    expect(withExt.interpolate("{ext.demoquest.step}")).toBe("接取委托");
    withExt.dispose();

    // 缺扩展读档 = fail-closed 整档拒绝（extension-missing 族）
    const withoutExt = new StoryEngine(questStory(), {});
    expect(withoutExt.importSave(save!)).toBe(false);
    withoutExt.dispose();
    engine.dispose();
  });

  it("未注册 quest = unknown-op fail-closed（未声明扩展时故事不静默跑过）", () => {
    const errors: string[] = [];
    const engine = new StoryEngine(questStory(), {});
    // onEvent 交付统一信封 {v, kind:'event', payload}——错误在内层 payload
    engine.onEvent((event) => {
      if (event.payload.kind === "engine.error") errors.push(event.payload.code);
    });
    engine.start();
    expect(errors).toContain("unknown-op");
    engine.dispose();
  });
});
