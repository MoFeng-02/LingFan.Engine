/**
 * SavePort 纯 Web 实现：localStorage 演示兜底（明文——不作为安全边界），
 * 语义对齐原生（高水位/计数由 Web 侧自管）。由组合根按平台装配。
 */
import type { SavePort, SlotSummary } from "@lingfan/engine";

/** 高水位计数键：本侧自管，`list` 时跳过它 */
const HW_KEY = "lf3-demo:highwater";
/** 槽位键前缀：拼键与 `list` 过滤共用，免得混入页面上的其它键 */
const PREFIX = "lf3-demo:";

/** 槽位名 → localStorage 键：加 `lf3-demo:` 前缀，免得与页面上其它键撞名 */
function slotKey(slot: string): string {
  return `${PREFIX}${slot}`;
}

/**
 * 造一个存档端口（浏览器演示兜底）：数据明文存 localStorage，同一台浏览器就是同一个档位空间。
 * 高水位计数由本侧自管，因此读旧档同样会被拒；`list` 只认 `lf3-demo:` 前缀且跳过高水位键。
 * 它不是安全边界，正式形态用原生端口。
 */
export function createWebStorageSavePort(): SavePort {
  return {
    async write(slot, payload, mode): Promise<void> {
      const highWater = Number(localStorage.getItem(HW_KEY) ?? "0");
      const saveCount = highWater + 1;
      localStorage.setItem(
        slotKey(slot),
        JSON.stringify({ payload, saveCount, timestamp: Date.now(), mode }),
      );
      localStorage.setItem(HW_KEY, String(saveCount));
    },
    async read(slot): Promise<string> {
      const raw = localStorage.getItem(slotKey(slot));
      if (raw === null) throw new Error(`槽位不存在：${slot}`);
      const record = JSON.parse(raw) as { payload: string; saveCount: number };
      const highWater = Number(localStorage.getItem(HW_KEY) ?? "0");
      if (record.saveCount < highWater)
        throw new Error("回档尝试被拒绝（演示高水位）");
      return record.payload;
    },
    async remove(slot): Promise<void> {
      localStorage.removeItem(slotKey(slot)); // 删档不动高水位（演示同语义）
    },
    async list(): Promise<SlotSummary[]> {
      const out: SlotSummary[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key === null || !key.startsWith(PREFIX) || key === HW_KEY) {
          continue;
        }
        const record = JSON.parse(localStorage.getItem(key) ?? "{}") as {
          saveCount?: number;
          timestamp?: number;
        };
        out.push({
          slot: key.slice(PREFIX.length),
          saveCount: record.saveCount ?? 0,
          timestamp: record.timestamp ?? 0,
          mode: "demo",
        });
      }
      return out;
    },
  };
}
