/**
 * 05 §五 SavePort 纯 Web 实现：localStorage 演示兜底（明文——不作为安全边界），
 * 语义对齐原生（高水位/计数由 Web 侧自管）。由组合根按平台装配。
 */
import type { SavePort, SlotSummary } from "@lingfan/engine";

const HW_KEY = "lf3-demo:highwater";
const PREFIX = "lf3-demo:";

function slotKey(slot: string): string {
  return `${PREFIX}${slot}`;
}

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
