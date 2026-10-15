/**
 * 叙事事件的落点：提示条、读档诊断与错误横幅。
 *
 * 事件怎么分流（哪个 `kind` 走哪条）留在组合根——分流顺序是接线契约；这里只收
 * 「落下去做什么」。读档与回溯共用同一条收尾顺序：先清错误横幅，再把视图状态与
 * 媒体渲染器对齐引擎当前状态，最后才提示——顺序反了会让玩家先看到提示、再看到
 * 画面跳回存档坐标。写档不动画面，只清错误横幅：横幅报的是「上一次操作的结果」，
 * 这一次既然成功，上一次的失败就已经过期，留着会让玩家以为仍有故障。
 *
 * 需要刷新渲染/媒体的分支把动作以具名回调注入，免得本模块反向依赖组合根手里的
 * 渲染器与视图状态。
 *
 * 本模块平台无关：不触碰任何框架、DOM 或宿主全局。
 */
import type { Notices } from "../notices";

/** 叙事事件落点需要的外部事实与出口 */
export interface NarrativeEventOptions {
  /** 提示条出口（语气与驻留档位由它决定） */
  notices: Notices;
  /** 清错误横幅 */
  clearError(): void;
  /** 视图状态整体对齐引擎当前状态 */
  syncFromEngine(): void;
  /** 媒体渲染器对齐（音频位置 + 视频命令流） */
  syncMedia(): void;
  /** 错误横幅写入 */
  reportError(message: string): void;
  /** 错误横幅文案：把引擎错误码与消息拼成一句话；缺省 = `code: message` */
  formatError?(code: string, message: string): string;
}

/** 叙事事件落点 */
export interface NarrativeEvents {
  /** 通知：语气由 `notifyType` 归一，时长缺省走通知档 */
  notify(
    text: string,
    notifyType: unknown,
    durationMs: number | undefined,
  ): void;
  /** 写档成功（失败走错误分支，不提示成功；同时清掉上一次失败留下的错误横幅） */
  saved(slot: string): void;
  /** 读档完成：引擎已重放到存档坐标 */
  loaded(slot: string): void;
  /** 回溯完成：解除输入锁并同步渲染 */
  rollbackDone(): void;
  /** 读档诊断（非致命，宿主应知情） */
  loadNotice(text: string): void;
  /** 引擎错误：`code: message` 进错误横幅 */
  failed(code: string, message: string): void;
}

/**
 * 创建叙事事件落点。读档与回溯共用的收尾顺序在本模块内只写一次。
 */
export function createNarrativeEvents(
  options: NarrativeEventOptions,
): NarrativeEvents {
  const formatError = options.formatError ?? defaultFormatError;
  /** 读档 / 回溯共用的收尾：清错误 → 视图与媒体对齐 → 提示 */
  function realign(): void {
    options.clearError();
    options.syncFromEngine();
    options.syncMedia();
  }

  return {
    notify(
      text: string,
      notifyType: unknown,
      durationMs: number | undefined,
    ): void {
      options.notices.notify(text, notifyType, durationMs);
    },
    saved(slot: string): void {
      options.clearError();
      options.notices.saved(slot);
    },
    loaded(slot: string): void {
      realign();
      options.notices.loaded(slot);
    },
    rollbackDone(): void {
      realign();
      options.notices.rollbackDone();
    },
    loadNotice(text: string): void {
      options.notices.loadNotice(text);
    },
    failed(code: string, message: string): void {
      options.reportError(formatError(code, message));
    },
  };
}

/** 错误横幅的缺省拼法：`code: message`（宿主可用 formatError 覆盖） */
function defaultFormatError(code: string, message: string): string {
  return `${code}: ${message}`;
}
