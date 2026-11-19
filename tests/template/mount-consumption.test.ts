/**
 * 壳页面与挂载消费的四件接线旅程：续玩槽位刷新、小游戏经注册表真挂载、
 * 示例扩展等待第三态跑通、对话框模板按名解析（未知名 fail-soft 回退默认）。
 *
 * 小游戏 / 扩展挂载分支共用展示层一份实现，这里用真引擎与最小 DOM 替身把
 * 「引擎让出 → 外部跑 → 回填 → 继续」全链与 fail-closed 边界钉死。
 */
import { describe, expect, it, vi } from "vitest";
import {
  StoryEngine,
  SYS,
  parseStory,
  type ExtensionMountPayload,
  type MinigameResult,
  type OutboundEvent,
  type SlotSummary,
} from "@lingfan-engine/core";
import {
  createExtensionMountHandler,
  createMinigameRegistry,
  handleMinigameMount,
  type ExtensionOverlay,
} from "@lingfan-engine/ui";
import { templateExtensions } from "../../template/v1/__PROJECT__/src/host/extensions";
import {
  registerTemplateMinigames,
  templateMinigames,
} from "../../template/v1/__PROJECT__/src/host/minigame-demo";
import { createTemplateDialogueTemplates } from "../../template/v1/__PROJECT__/src/host/dialogue-templates";
import { createResumePage } from "../../template/v1/__PROJECT__/src/host/resume-page";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** 最小游戏宿主替身：只承诺挂载分支用到的 innerHTML / classList */
function makeHost(): {
  innerHTML: string;
  classList: { remove: ReturnType<typeof vi.fn> };
} {
  return { innerHTML: "旧内容", classList: { remove: vi.fn() } };
}

/** 最小按钮替身：禁用态 + 点击监听（续玩入口用） */
class FakeButton {
  disabled = false;
  private listeners: Array<() => void> = [];
  addEventListener(_type: string, handler: () => void): void {
    this.listeners.push(handler);
  }
  removeEventListener(_type: string, handler: () => void): void {
    this.listeners = this.listeners.filter((h) => h !== handler);
  }
  click(): void {
    for (const handler of [...this.listeners]) handler();
  }
}

function summary(slot: string, timestamp: number): SlotSummary {
  return { slot, saveCount: 1, timestamp, mode: "manual" };
}

describe("续玩槽位刷新（resume-slot-refresh）", () => {
  // slots 是槽位数（slot_1..slot_N），不是名字表
  const manifest = { shell: { saves: { slots: 2 } } };

  it("有旧档：继续指向最新一档，点击读它", async () => {
    const button = new FakeButton();
    const loaded: string[] = [];
    const page = createResumePage({
      button: button as unknown as HTMLButtonElement,
      savePort: {
        list: async () => [summary("slot_1", 1), summary("slot_2", 2)],
      } as never,
      manifest,
      load: (slot) => loaded.push(slot),
    });
    await page.refresh();
    expect(button.disabled).toBe(false);
    button.click();
    expect(loaded).toEqual(["slot_2"]); // 时间戳最大的 slot_2
    page.dispose();
  });

  it("无旧档：继续禁用，点击不读档", async () => {
    const button = new FakeButton();
    const loaded: string[] = [];
    const page = createResumePage({
      button: button as unknown as HTMLButtonElement,
      savePort: { list: async () => [] } as never,
      manifest,
      load: (slot) => loaded.push(slot),
    });
    await page.refresh();
    expect(button.disabled).toBe(true);
    button.click();
    expect(loaded).toEqual([]);
    page.dispose();
  });

  it("写档后刷新：新档成为可续槽位（槽位变多继续点得到）", async () => {
    const button = new FakeButton();
    let summaries: SlotSummary[] = [summary("slot_1", 1)];
    const loaded: string[] = [];
    const page = createResumePage({
      button: button as unknown as HTMLButtonElement,
      savePort: { list: async () => summaries } as never,
      manifest,
      load: (slot) => loaded.push(slot),
    });
    await page.refresh();
    button.click();
    expect(loaded).toEqual(["slot_1"]);
    summaries = [summary("slot_1", 1), summary("slot_2", 9)]; // 模拟又存了一档
    await page.refresh();
    button.click();
    expect(loaded).toEqual(["slot_1", "slot_2"]);
    page.dispose();
  });

  it("清单读失败：继续禁用不阻断（存档能用优先）", async () => {
    const button = new FakeButton();
    const page = createResumePage({
      button: button as unknown as HTMLButtonElement,
      savePort: {
        list: async () => {
          throw new Error("io");
        },
      } as never,
      manifest,
      load: () => {},
    });
    await page.refresh();
    expect(button.disabled).toBe(true);
    page.dispose();
  });

  it("拆除后点击不再读档", async () => {
    const button = new FakeButton();
    const loaded: string[] = [];
    const page = createResumePage({
      button: button as unknown as HTMLButtonElement,
      savePort: { list: async () => [summary("slot_1", 1)] } as never,
      manifest,
      load: (slot) => loaded.push(slot),
    });
    await page.refresh();
    page.dispose();
    button.click();
    expect(loaded).toEqual([]);
  });
});

describe("小游戏经注册表真挂载（minigame-mounts-registry）", () => {
  it("脚手架注册声明与工厂就位（demo 可解析）", () => {
    const registry = createMinigameRegistry();
    registerTemplateMinigames(registry);
    expect(registry.has("demo")).toBe(true);
    expect(templateMinigames.map((m) => m.gameId)).toContain("demo");
  });

  it("已注册：工厂跑完回填结果，宿主收尾清空", async () => {
    const registry = createMinigameRegistry();
    registry.register("demo", () => Promise.resolve({ outcome: "success" }));
    const host = makeHost();
    const resolved: MinigameResult[] = [];
    const inMinigame = { value: true };
    handleMinigameMount(
      {
        kind: "minigame.mount",
        game: "demo",
        config: {},
        signal: new AbortController().signal,
        seq: 1,
      },
      {
        minigames: registry,
        readHost: () => host as unknown as HTMLElement,
        teardownHost: (h) => {
          (h as { innerHTML: string }).innerHTML = "";
        },
        inMinigame,
        error: { value: "" },
        resolveMinigame: (r) => resolved.push(r),
        writer: {} as never,
      },
    );
    await flush();
    expect(resolved).toEqual([{ outcome: "success" }]);
    expect(host.innerHTML).toBe(""); // 收尾清空
    expect(inMinigame.value).toBe(false);
  });

  it("未注册：fail-closed 上报不伪造完成（用户实测回归）", async () => {
    const registry = createMinigameRegistry();
    const host = makeHost();
    const resolved: MinigameResult[] = [];
    const error = { value: "" };
    handleMinigameMount(
      {
        kind: "minigame.mount",
        game: "ghost",
        config: {},
        signal: new AbortController().signal,
        seq: 1,
      },
      {
        minigames: registry,
        readHost: () => host as unknown as HTMLElement,
        teardownHost: (h) => {
          (h as { innerHTML: string }).innerHTML = "";
        },
        inMinigame: { value: true },
        error,
        resolveMinigame: (r) => resolved.push(r),
        writer: {} as never,
      },
    );
    await flush();
    expect(error.value).toContain("小游戏未注册");
    expect(error.value).toContain("ghost");
    expect(resolved).toEqual([]); // 不伪造完成
  });

  it("中断竞态：abort 后工厂结果不回填", async () => {
    const registry = createMinigameRegistry();
    const controller = new AbortController();
    let release: (r: MinigameResult) => void = () => {};
    registry.register(
      "demo",
      () =>
        new Promise<MinigameResult>((r) => {
          release = r;
        }),
    );
    const host = makeHost();
    const resolved: MinigameResult[] = [];
    handleMinigameMount(
      {
        kind: "minigame.mount",
        game: "demo",
        config: {},
        signal: controller.signal,
        seq: 1,
      },
      {
        minigames: registry,
        readHost: () => host as unknown as HTMLElement,
        teardownHost: (h) => {
          (h as { innerHTML: string }).innerHTML = "";
        },
        inMinigame: { value: true },
        error: { value: "" },
        resolveMinigame: (r) => resolved.push(r),
        writer: {} as never,
      },
    );
    controller.abort(); // 回溯/导航离开
    release({ outcome: "success" });
    await flush();
    expect(resolved).toEqual([]); // 以 abort 收尾为准
    expect(host.innerHTML).toBe("");
  });
});

describe("示例扩展等待第三态跑通（extension-op-runs）", () => {
  function mountedEngine(): { engine: StoryEngine; events: OutboundEvent[] } {
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "demo",
        columns: [
          {
            id: "s",
            kind: "flow",
            commands: [
              { op: "say", text: "一" },
              { op: "demo_wait", note: "测试等待" },
              { op: "say", text: "二" },
            ],
          },
        ],
      }),
      { extensions: templateExtensions },
    );
    const events: OutboundEvent[] = [];
    engine.onEvent((e) => events.push(e));
    engine.start();
    engine.advance(); // 第一句解除 → demo_wait 建立等待
    return { engine, events };
  }

  it("exec 写命名空间状态 + 出站 extension.mount，覆盖层确认后继续", () => {
    const { engine, events } = mountedEngine();
    const mount = events.find((e) => e.payload.kind === "extension.mount")
      ?.payload as ExtensionMountPayload | undefined;
    expect(mount?.op).toBe("demo_wait");
    expect(mount?.extensionId).toBe("demo");
    expect(mount?.config.detail).toBe("测试等待");
    expect(engine.get("ext.demo.note")).toBe("测试等待"); // 状态进 SSOT

    // 宿主覆盖层展示态（共用展示层编排）
    const overlay: { value: ExtensionOverlay | null } = { value: null };
    const handler = createExtensionMountHandler({ overlay });
    handler(mount as ExtensionMountPayload);
    expect(overlay.value?.title).toContain("demo.demo_wait");
    expect(overlay.value?.detail).toBe("测试等待");

    // 确认解除 → 故事继续到第二句
    expect(engine.resolveExtensionOp("demo_wait", { outcome: "success" })).toBe(
      true,
    );
    engine.advance();
    expect(engine.get(SYS.currentDialogText)).toBe("二");
  });

  it("中断：abort 清空覆盖层展示态", () => {
    const { engine, events } = mountedEngine();
    const mount = events.find((e) => e.payload.kind === "extension.mount")
      ?.payload as ExtensionMountPayload;
    const overlay: { value: ExtensionOverlay | null } = { value: null };
    const handler = createExtensionMountHandler({ overlay });
    handler(mount);
    expect(overlay.value).not.toBeNull();
    engine.back(); // 回溯中断接管
    expect(overlay.value).toBeNull();
  });
});

describe("对话框模板按名解析（dialog-template-priority）", () => {
  const input = {
    speaker: "",
    speakerColor: "",
    lineHtml: "台词",
    canAdvance: true,
  };

  it("注册名命中：center 换皮肤类", () => {
    const registry = createTemplateDialogueTemplates();
    const fn = registry.resolve("center");
    expect(fn?.(input).rootClass).toBe("tpl-center");
  });

  it("未知名 fail-soft 回退默认 bubble（与注册表 fail-closed 刻意不同）", () => {
    const registry = createTemplateDialogueTemplates();
    const fn = registry.resolve("不存在");
    expect(fn?.(input).rootClass).toBe("tpl-bubble");
    expect(fn?.(input).bodyHtml).toBe("台词"); // 模板只换皮，正文语义不变
  });

  it("null / 空名回退默认（核心未解析出模板名时）", () => {
    const registry = createTemplateDialogueTemplates();
    expect(registry.resolve(null)?.(input).rootClass).toBe("tpl-bubble");
    expect(registry.resolve("")?.(input).rootClass).toBe("tpl-bubble");
  });

  it("推进指示随 canAdvance（模板不改交互语义）", () => {
    const registry = createTemplateDialogueTemplates();
    const fn = registry.resolve("bubble");
    expect(fn?.({ ...input, canAdvance: true }).hintHtml).toBe("▼");
    expect(fn?.({ ...input, canAdvance: false }).hintHtml).toBe("");
  });
});
