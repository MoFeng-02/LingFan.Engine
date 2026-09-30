/**
 * 浏览器游戏模式守卫：正式构建下**外部浏览器不得进入游戏**——交付形态只应是 Tauri 壳
 * （invoke + 加密资源），浏览器形态仅限开发便利与显式声明的「浏览器游戏模式」。
 *
 * 为什么要有这条守卫：Web 形态的工程供给与资源供给都走**静态根**（`fetch` + 明文
 * `Resources/**`），任何人拿到产物就能绕过应用直接扒资源；Tauri 形态则走 Rust 命令面
 * （加密资源 + 最小暴露面）。两种供给面不可共存于同一个交付物。
 *
 * 判据（两者都是**编译期常量**，可静态求值）：
 *   - `import.meta.env.DEV` → 开发模式（`vite dev` / `tauri dev`）放行：开发便利，
 *     且这正是「浏览器复用宿主能力」场景的前提；
 *   - `VITE_LFEN_BROWSER_GAME=1` → 显式「浏览器游戏模式」放行（想把游戏按 Web 形态
 *     分发时的例外口，与脚手架 `template/v1` 同一形态）；
 *   - **其余生产构建一律封闭**（fail-closed：不猜、不静默降级）。
 *
 * 形态判定须用**运行时事实**（`__TAURI_INTERNALS__`）而非只看构建标记：tauri 形态的页面
 * 可能落在外部浏览器（`tauri dev` 时浏览器开 `localhost:1420`），那种情况下同样没有壳，
 * 必须走本守卫而不是 invoke。
 */

/** 浏览器游戏模式开关名（构建期 env；与 `vite.config.ts` 的读取互锁，防两侧漂移） */
export const BROWSER_GAME_FLAG = "VITE_LFEN_BROWSER_GAME";

/** 判定所需的两个事实（显式入参便于真值表单测；缺省取真实构建环境） */
export interface BrowserPlayEnv {
  /** 构建/运行是否开发模式（`import.meta.env.DEV`） */
  dev: boolean;
  /** 浏览器游戏模式开关原值（`import.meta.env.VITE_LFEN_BROWSER_GAME`） */
  browserGame: string | undefined;
}

/** 是否允许在浏览器（无 Tauri 壳）中进入游戏：`dev || 显式开关 === "1"`（其余封闭） */
export function browserPlayAllowed(env?: BrowserPlayEnv): boolean {
  const { dev, browserGame } = env ?? {
    dev: import.meta.env.DEV,
    browserGame: import.meta.env.VITE_LFEN_BROWSER_GAME,
  };
  return dev || browserGame === "1";
}

/** 封闭时的可操作说明（渲染进 `#app`：不白屏、不静默失败） */
export function browserBlockedMessage(): string {
  return [
    "此构建不允许在浏览器中运行。",
    "",
    "正式交付的游戏只经桌面/移动壳运行（资源加密 + 命令面最小化）；",
    "浏览器形态仅限开发调试，或显式声明为浏览器游戏模式：",
    "",
    `  以 ${BROWSER_GAME_FLAG}=1 重新构建产物`,
    "",
    "（开发调试请用 `pnpm dev`，无需任何开关。）",
  ].join("\n");
}
