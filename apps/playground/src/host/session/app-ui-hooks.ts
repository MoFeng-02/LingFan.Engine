/**
 * 宿主界面侧的两处登记：进对局的调试标志桥，与元素 `cmd` 的业务命令注册。
 *
 * 两者都只把「界面此刻的状态」暴露给外部（自动化探针 / 元素按钮），不含任何策略：
 * 真正的动作仍由调用方传入的处理函数承担。
 */

import { watch, type Ref } from "vue";
import { type createCommandRegistry } from "@lingfan-engine/ui";

/** 登记入参：页面态与三类命令的处理函数 */
export interface AppUiHooksOptions {
  /** 是否已进对局（页面态来源） */
  inGame: Ref<boolean>;
  /** 元素 `cmd` 的业务命令注册表 */
  commands: ReturnType<typeof createCommandRegistry>;
  /** 历史面板开关 */
  toggleHistory: () => void;
  /** 设置面板显隐（收发同一份 ref） */
  showPrefs: Ref<boolean>;
  /** 整体重开一局 */
  restart: () => void;
}

/**
 * 登记调试标志与 `cmd` 命令。
 *
 * 调试标志与页面态同源：自动化探针读它即可区分「还没进对局」与「进了但对局静止」，
 * 它不参与运行逻辑。未注册的 `cmd` 由元素层 fail-closed 上报，不静默丢弃。
 */
export function attachAppUiHooks(options: AppUiHooksOptions): void {
  const { inGame, commands, toggleHistory, showPrefs, restart } = options;
  watch(
    inGame,
    (value) => {
      (window as { __engineStarted?: boolean }).__engineStarted = value;
    },
    { immediate: true },
  );
  commands.register("history", () => {
    toggleHistory();
  });
  commands.register("prefs", () => {
    showPrefs.value = !showPrefs.value;
  });
  commands.register("restart", () => {
    restart();
  });
}
