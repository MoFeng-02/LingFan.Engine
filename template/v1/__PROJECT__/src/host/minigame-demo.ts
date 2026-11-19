/**
 * 示例小游戏：演示「引擎让出控制权 → 外部系统跑 → 回填结果 → 引擎继续」全链。
 *
 * 工厂往共享挂载点画一个按钮，点一下即成功并回填一笔状态（引擎落 `game.demo.*` 前缀）。
 * 中止（回溯/导航/读档/销毁）由挂载分支统一收尾（清挂载点），工厂只需在 `signal.aborted`
 * 置位后尽快结束、不再回填——这里以「失败」收束 pending Promise，结果会被挂载分支丢弃。
 */
import type {
  MinigameFactory,
  MinigameRegistration,
} from "@lingfan-engine/core";
import type { MinigameRegistry } from "@lingfan-engine/ui";

/** 示例小游戏工厂（host 是共享挂载点元素，契约以 unknown 承载，宿主收窄回 DOM）。 */
export const demoMinigame: MinigameFactory = (host, ctx) => {
  const el = host as HTMLElement;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "完成小游戏";
  button.setAttribute("aria-label", "完成小游戏");
  el.append(button);
  return new Promise((resolve) => {
    const signal = ctx.signal as AbortSignal;
    const onAbort = (): void => resolve({ outcome: "fail" });
    signal.addEventListener("abort", onAbort, { once: true });
    button.addEventListener(
      "click",
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve({ outcome: "success", state: { cleared: true } });
      },
      { once: true },
    );
  });
};

/** 示例小游戏的引擎注册声明（gameId 进存档依赖标记；stateVersion 是状态 schema 版本）。 */
export const templateMinigames: readonly MinigameRegistration[] = [
  { gameId: "demo", stateVersion: 1 },
];

/** 把脚手架自带的小游戏工厂登记进宿主注册表（组合根装配；作者可照此追加）。 */
export function registerTemplateMinigames(registry: MinigameRegistry): void {
  registry.register("demo", demoMinigame);
}
