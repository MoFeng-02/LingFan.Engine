/**
 * SavePort 同步键值存储实现：浏览器走 localStorage（演示兜底，明文——不作为安全边界），
 * 其它平台注入等价面（小程序同步存储见 `../miniprogram/save.ts`），语义对齐原生（高水位/计数由本侧自管）。
 * 由组合根按平台装配。
 *
 * 高水位**按槽位各记一份**：它防的是「同一槽位被一份更旧的记录覆盖回来」，
 * 与别的槽位无关。记成全局计数会把不同槽位的写入顺序当成版本关系——后写的槽位
 * 一写，先写的槽位计数就落后于全局高水位，读它会被判回档，槽位上的标题与缩略图
 * 随之消失（`loadSlotViews` 把拒读降级成空元信息）。
 */
import type { SavePort, SlotSummary } from "@lingfan-engine/core";

/**
 * 同步键值存储面：`SavePort` 实现只依赖这四个动作，不认具体平台对象。
 * `keys()` 是 `list` 的扫键面（`localStorage` 自身没有，见 `createLocalStorageFace`）。
 */
export interface SyncStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): readonly string[];
}

/** 浏览器缺省面：`localStorage` 补上 `keys()`（用 `length` + `key(i)` 拼） */
export function createLocalStorageFace(): SyncStorageLike {
  return {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: (key) => localStorage.removeItem(key),
    keys: () => {
      const out: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key !== null) out.push(key);
      }
      return out;
    },
  };
}

/** 存储键命名空间（键名前缀）：宿主可按部署页面的键位规划覆盖，缺省沿用演示值 */
export interface WebStorageSaveOptions {
  /** 高水位键的命名空间（逐槽键为「它 + `:` + 槽位名」）；缺省 "lf3-demo:highwater" */
  highWaterKey?: string;
  /** 槽位键前缀（拼键与 `list` 过滤共用）；缺省 "lf3-demo:" */
  keyPrefix?: string;
}

/** 存储键命名空间的缺省值：沿用演示工程的既有键位 */
const DEFAULT_HIGH_WATER_KEY = "lf3-demo:highwater";
const DEFAULT_KEY_PREFIX = "lf3-demo:";

/**
 * 造一个存档端口（同步键值存储）：数据明文存进去，同一存储面就是同一个档位空间。
 * 高水位逐槽自管，因此同一槽位读旧记录会被拒；`list` 只认 `keyPrefix` 前缀且跳过全部高水位键。
 * 它不是安全边界，正式形态用原生端口。
 * @param options 存储键命名空间；缺省沿用演示值（`lf3-demo:`），已有存档数据换前缀后读不到——迁移由宿主自管
 * @param storage 同步键值存储面；缺省浏览器 `localStorage`（其它平台注入等价物）
 */
export function createWebStorageSavePort(
  options?: WebStorageSaveOptions,
  storage: SyncStorageLike = createLocalStorageFace(),
): SavePort {
  const highWaterKey = options?.highWaterKey ?? DEFAULT_HIGH_WATER_KEY;
  const prefix = options?.keyPrefix ?? DEFAULT_KEY_PREFIX;
  /** 槽位名 → 存储键：加命名空间前缀，免得与页面上其它键撞名 */
  const slotKey = (slot: string): string => `${prefix}${slot}`;
  /** 槽位名 → 该槽位的高水位键（槽位 id 不许带冒号，故「高水位键 + `:` + 槽位名」不会与槽位键相撞） */
  const slotHighWaterKey = (slot: string): string => `${highWaterKey}:${slot}`;
  const readHighWater = (slot: string): number =>
    Number(storage.getItem(slotHighWaterKey(slot)) ?? "0");
  /**
   * 高水位键是不是扫键扫到的「槽位」：逐槽键形如「高水位命名空间 + `:` + 槽位名」，
   * 命名空间本身也算（旧版全局键，读到就当没有——它不再参与判定）。
   */
  const isHighWaterKey = (key: string): boolean =>
    key === highWaterKey || key.startsWith(`${highWaterKey}:`);
  return {
    async write(slot, payload, mode): Promise<void> {
      const saveCount = readHighWater(slot) + 1;
      storage.setItem(
        slotKey(slot),
        JSON.stringify({ payload, saveCount, timestamp: Date.now(), mode }),
      );
      storage.setItem(slotHighWaterKey(slot), String(saveCount));
    },
    async read(slot): Promise<string> {
      const raw = storage.getItem(slotKey(slot));
      if (raw === null) throw new Error(`槽位不存在：${slot}`);
      const record = JSON.parse(raw) as { payload: string; saveCount: number };
      if (record.saveCount < readHighWater(slot))
        throw new Error("回档尝试被拒绝（演示高水位）");
      return record.payload;
    },
    async remove(slot): Promise<void> {
      storage.removeItem(slotKey(slot)); // 删档不动高水位（演示同语义）
    },
    async list(): Promise<SlotSummary[]> {
      const out: SlotSummary[] = [];
      for (const key of storage.keys()) {
        if (!key.startsWith(prefix) || isHighWaterKey(key)) {
          continue;
        }
        const record = JSON.parse(storage.getItem(key) ?? "{}") as {
          saveCount?: number;
          timestamp?: number;
        };
        out.push({
          slot: key.slice(prefix.length),
          saveCount: record.saveCount ?? 0,
          timestamp: record.timestamp ?? 0,
          mode: "demo",
        });
      }
      return out;
    },
  };
}
