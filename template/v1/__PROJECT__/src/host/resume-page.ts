/**
 * 续玩入口：启动 / 暂停页的「继续」按钮，读最近一次存档接着玩。
 *
 * 「继续」指向哪个槽位由 `latestSave` 判定（只认工程配置内的槽、按时间戳取最新），
 * 与存档自选共用同一份判定，不各写一套。没有可续的档时按钮禁用（不伪造一个空读档）。
 * 写档成功后由组合根调 `refresh()` 重算——槽位变多，「继续」要能点到新的档。
 * 读档清单失败只让按钮禁用，不阻断启动（存档能用优先于续玩好看）。
 */
import {
  resolveSavesConfig,
  slotIds,
  type SavePort,
} from "@lingfan-engine/core";
import { latestSave } from "@lingfan-engine/ui";

/** 续玩入口所需的宿主侧依赖 */
export interface ResumePageOptions {
  /** 「继续」按钮（无可续档时禁用） */
  button: HTMLButtonElement;
  /** 存档端口（读槽位摘要） */
  savePort: SavePort;
  /** 工程清单（槽位口径来自 `shell.saves.slots`） */
  manifest: unknown;
  /** 读档（引擎既有命令面，宿主不自己拼存档数据） */
  load(slot: string): void;
}

/** 续玩入口：刷新可续槽位 + 点击读档 + 拆除退订 */
export interface ResumePage {
  /** 重算可续槽位（启动与写档成功后调） */
  refresh(): Promise<void>;
  /** 退订点击（拆除时调） */
  dispose(): void;
}

/** 造续玩入口：按钮禁用态跟随最近存档，点击读最近一档 */
export function createResumePage(options: ResumePageOptions): ResumePage {
  const slots = slotIds(resolveSavesConfig(options.manifest).slots);
  let current: string | undefined;
  async function refresh(): Promise<void> {
    try {
      const summaries = await options.savePort.list();
      current = latestSave(summaries, slots)?.slot;
    } catch {
      current = undefined; // 清单读不到：继续入口禁用，不阻断启动
    }
    options.button.disabled = current === undefined;
  }
  const onClick = (): void => {
    if (current !== undefined) options.load(current);
  };
  options.button.addEventListener("click", onClick);
  return {
    refresh,
    dispose: () => options.button.removeEventListener("click", onClick),
  };
}
