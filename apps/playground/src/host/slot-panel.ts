/**
 * 槽位面板的数据装配：把存档端口的清单与逐槽快照整理成可直接渲染的视图。
 *
 * 面板只负责「呈现槽位」：写读与校验由引擎命令面承担（`engine.save` /
 * `engine.load`），此处读取存档端口仅为取标题与缩略图；读取失败按空槽呈现，
 * 真实读档失败由引擎 fail-closed 上报。
 */
import type { SaveDataV1, SavePort } from "@lingfan/engine";

/** 面板用途：存或读 */
export type SlotPanelMode = "save" | "load";

/** 一个槽位的呈现数据 */
export interface SlotView {
  /** 槽位 id（引擎命令参数） */
  id: string;
  /** 槽位显示名 */
  label: string;
  /** 无存档（点选后仍走引擎命令面） */
  empty: boolean;
  /** 存档时间戳（无存档时不呈现） */
  timestamp?: number;
  /** 存档标题（快照里没有则缺省） */
  title?: string;
  /** 缩略图 data URL（快照里没有则缺省） */
  screenshot?: string;
}

/** 槽位装配需要的外部事实 */
export interface SlotPanelOptions {
  /** 存档端口（清单与逐槽读取） */
  savePort: SavePort;
  /** 本工程的槽位 id 序列（顺序即呈现顺序） */
  slotIds: readonly string[];
}

/**
 * 从快照原文里取出标题与缩略图。
 *
 * 单点收敛解析与容错：读到的内容可能不是本版本的存档（或已损坏），
 * 解析失败与字段类型不符都按「没有」处理，不中断面板装配。
 */
export function parseSlotMeta(raw: string): {
  title?: string;
  screenshot?: string;
} {
  try {
    const parsed = JSON.parse(raw) as Partial<SaveDataV1>;
    return {
      title: typeof parsed.title === "string" ? parsed.title : undefined,
      screenshot:
        typeof parsed.screenshot === "string" ? parsed.screenshot : undefined,
    };
  } catch {
    return {};
  }
}

/** 装配槽位视图列表 */
export async function loadSlotViews(
  options: SlotPanelOptions,
): Promise<SlotView[]> {
  const summaries = await options.savePort.list().catch(() => []);
  const byId = new Map(summaries.map((s) => [s.slot, s]));
  const views: SlotView[] = [];
  for (const id of options.slotIds) {
    const summary = byId.get(id);
    let meta: { title?: string; screenshot?: string } = {};
    if (summary !== undefined) {
      meta = parseSlotMeta(await options.savePort.read(id));
    }
    views.push({
      id,
      label: id.replace("slot_", "槽位 "),
      empty: summary === undefined,
      timestamp: summary?.timestamp,
      title: meta.title,
      screenshot: meta.screenshot,
    });
  }
  return views;
}
