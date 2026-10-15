/**
 * 槽位面板的数据装配：把存档端口的清单与逐槽快照整理成可直接渲染的视图。
 *
 * 面板只负责「呈现槽位」：写读与校验由引擎命令面承担（`engine.save` /
 * `engine.load`），此处读取存档端口仅为取标题与缩略图；个别槽读取失败只丢这两项，
 * 不影响整张面板装出来，真实读档失败由引擎 fail-closed 上报。
 *
 * 本模块平台无关：不触碰任何框架、DOM 或宿主全局。
 */
import type { SaveDataV1, SavePort } from "@lingfan/engine";

/** 面板用途：存或读 */
export type SlotPanelMode = "save" | "load";

/** 一个槽位的呈现数据 */
export interface SlotView {
  /** 槽位 id（引擎命令参数） */
  id: string;
  /** 槽位显示名（与提示条文案同源，见 {@link defaultSlotLabel}） */
  label: string;
  /** 无存档（存档模式仍可点选=覆盖写入；读档模式不可点选，见 {@link canChooseSlot}） */
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
  /** 槽位显示名：把槽位 id 变成面板上给玩家看的一行字；缺省 = 去掉 `slot_` 前缀后加「槽位 」 */
  labelFor?(id: string): string;
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
  const labelFor = options.labelFor ?? defaultSlotLabel;
  const summaries = await options.savePort.list().catch(() => []);
  const byId = new Map(summaries.map((s) => [s.slot, s]));
  const views: SlotView[] = [];
  for (const id of options.slotIds) {
    const summary = byId.get(id);
    let meta: { title?: string; screenshot?: string } = {};
    if (summary !== undefined) {
      // 这次读只用来取标题与缩略图，端口拒读（旧档高水位、安全策略、记录损坏）不该
      // 让整张面板装不出来：那种槽位照列，只是没有标题与缩略图。
      meta = await options.savePort.read(id).then(parseSlotMeta, () => ({}));
    }
    views.push({
      id,
      label: labelFor(id),
      empty: summary === undefined,
      timestamp: summary?.timestamp,
      title: meta.title,
      screenshot: meta.screenshot,
    });
  }
  return views;
}

/**
 * 槽位显示名的缺省规则：`slot_1` → `槽位 1`，其余 id 原样透传。
 *
 * 导出是为了让槽位名的规则全仓只有一处：面板的 `labelFor` 与提示条的
 * `labelFor` 都缺省到它（宿主自定义命名时应把同一个函数传给两处），
 * 否则面板写「槽位 1」、提示条写 `slot_1`，同一次操作在两处叫法不同。
 */
export function defaultSlotLabel(id: string): string {
  return id.startsWith("slot_") ? `槽位 ${id.slice(5)}` : id;
}

/**
 * 槽位是否可点选。
 *
 * 读档模式下的空槽点下去必然失败（引擎读不到存档即 fail-closed），玩家只会收到
 * 一条报错；所以空槽在读档模式置灰，在存档模式下可点——那是一次覆盖写入。
 * `mode` 为 null（面板未打开）时一律不可点。
 */
export function canChooseSlot(
  view: SlotView,
  mode: SlotPanelMode | null,
): boolean {
  if (mode === "save") return true;
  return mode === "load" && !view.empty;
}
