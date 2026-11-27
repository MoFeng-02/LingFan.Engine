/**
 * 示例玩法系统：演示「引擎让出控制权 → 外部系统整屏接管 → 回填结果 → 引擎继续」全链。
 *
 * 与小游戏示例（`minigame-demo.ts`）的差别只在语义专一程度：interaction 面向
 * 行走 / 战斗 / 背包这类持续玩法系统，工厂经 `ctx.writer` 把玩法状态写进
 * `game.<system>.<key>` 命名空间（状态即接口——写入即入档，随快照/存档/回溯随行）。
 * 本示例用一个按钮收束：点一下即成功并回填一笔状态（引擎落 `game.demo.*` 前缀）。
 *
 * 中止（回溯/导航/读档/销毁）由挂载分支统一收尾（清挂载点），工厂只需在
 * `signal.aborted` 置位后尽快结束、不再回填——这里以「失败」收束 pending Promise，
 * 结果会被挂载分支丢弃。
 */
import type {
  GameStateWriter,
  InteractionContext,
  InteractionResult,
} from "@lingfan-engine/core";

/**
 * 玩法系统挂载上下文：契约 `InteractionContext` + 状态写入面。
 * writer 由挂载分支注入（引擎实例的 `gameState`），与小游戏分支同一口径。
 */
export type HostInteractionContext = InteractionContext & {
  writer: GameStateWriter;
};

/** 玩法系统工厂：宿主收窄容器类型后实现（本宿主 = HTMLElement） */
export type HostInteractionFactory = (
  host: HTMLElement,
  ctx: HostInteractionContext,
) => Promise<InteractionResult>;

/**
 * 玩法系统注册表：system 名 → 工厂。与小游戏注册表同口径——
 * **未注册 = fail-closed**（get 返回 undefined，调用方必须显式上报，不伪造完成）。
 */
export interface InteractionRegistry {
  /** 注册/覆盖更新（同 system 再注册 = 替换，开发热替换语义） */
  register(system: string, factory: HostInteractionFactory): void;
  /** 解析工厂；未注册 = undefined（fail-closed：不伪造默认实现） */
  get(system: string): HostInteractionFactory | undefined;
  has(system: string): boolean;
}

/** 造一张空的玩法系统表；系统由宿主在装配期逐个注册 */
export function createInteractionRegistry(): InteractionRegistry {
  const factories = new Map<string, HostInteractionFactory>();
  return {
    register(system: string, factory: HostInteractionFactory): void {
      factories.set(system, factory);
    },
    get(system: string): HostInteractionFactory | undefined {
      return factories.get(system);
    },
    has(system: string): boolean {
      return factories.has(system);
    },
  };
}

/** 示例玩法系统工厂（host 是共享挂载点，本宿主收窄回 DOM）。 */
export const demoInteraction: HostInteractionFactory = (host, ctx) => {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "完成玩法演示";
  button.setAttribute("aria-label", "完成玩法演示");
  host.append(button);
  return new Promise((resolve) => {
    const signal = ctx.signal as AbortSignal;
    const onAbort = (): void => resolve({ outcome: "fail" });
    signal.addEventListener("abort", onAbort, { once: true });
    button.addEventListener(
      "click",
      () => {
        signal.removeEventListener("abort", onAbort);
        // 状态即接口：玩法事实经写入面落 game.demo.*，随快照/存档/回溯随行
        ctx.writer.setScoped("demo", "visited", true);
        resolve({ outcome: "success", state: { cleared: true } });
      },
      { once: true },
    );
  });
};

/** 把脚手架自带的玩法系统工厂登记进宿主注册表（组合根装配；作者可照此追加）。 */
export function registerTemplateInteractions(
  registry: InteractionRegistry,
): void {
  registry.register("demo", demoInteraction);
}
