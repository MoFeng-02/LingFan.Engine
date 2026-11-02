/**
 * 浏览器存档端口（同步键值存储）测试：一个内存存储面替身。
 * 要锁住的核心语义是**高水位逐槽独立**——写成全局计数会让「后存的槽位」把先存的槽位
 * 判成回档，槽位上的标题与缩略图随之消失；其余命名空间、列表、删档语义一并钉住。
 */
import { describe, expect, it } from "vitest";
import type { SyncStorageLike } from "@lingfan-engine/adapters";
import { createWebStorageSavePort } from "@lingfan-engine/adapters";

/** 同步存储替身：按插入顺序记键，行为对齐 `localStorage` */
class FakeStorage implements SyncStorageLike {
  private map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  keys(): readonly string[] {
    return [...this.map.keys()];
  }
}

describe("createWebStorageSavePort：高水位逐槽独立", () => {
  it("写第二个槽位不影响第一个槽位的可读性", async () => {
    const storage = new FakeStorage();
    const port = createWebStorageSavePort({}, storage);
    await port.write("slot_1", "一", "machine-bound");
    await port.write("slot_2", "二", "machine-bound");
    // 全局计数实现下这里会抛「回档尝试被拒绝」：slot_1 计数 1 < 全局高水位 2
    await expect(port.read("slot_1")).resolves.toBe("一");
    await expect(port.read("slot_2")).resolves.toBe("二");
  });

  it("每个槽位的计数各从 1 起，覆盖只在自身槽位递增", async () => {
    const storage = new FakeStorage();
    const port = createWebStorageSavePort({}, storage);
    await port.write("slot_1", "一", "machine-bound");
    await port.write("slot_1", "一一", "machine-bound");
    await port.write("slot_2", "二", "machine-bound");
    const bySlot = new Map(
      (await port.list()).map((summary) => [summary.slot, summary.saveCount]),
    );
    expect(bySlot.get("slot_1")).toBe(2);
    expect(bySlot.get("slot_2")).toBe(1);
    await expect(port.read("slot_2")).resolves.toBe("二");
  });

  it("同一槽位的更旧记录仍被拒（逐槽防回档没被削弱）", async () => {
    const storage = new FakeStorage();
    const port = createWebStorageSavePort({}, storage);
    await port.write("slot_1", "旧", "machine-bound");
    const older = storage.getItem("lf3-demo:slot_1");
    await port.write("slot_1", "新", "machine-bound");
    storage.setItem("lf3-demo:slot_1", older ?? "{}"); // 旧记录放回
    await expect(port.read("slot_1")).rejects.toThrow("回档尝试被拒绝");
  });

  it("列表里不出现任何高水位键（含旧版全局键）", async () => {
    const storage = new FakeStorage();
    const port = createWebStorageSavePort({}, storage);
    await port.write("slot_1", "一", "machine-bound");
    storage.setItem("lf3-demo:highwater", "9"); // 旧版全局键残留
    const slots = (await port.list()).map((summary) => summary.slot);
    expect(slots).toEqual(["slot_1"]);
  });

  it("删档不动该槽位的高水位：读旧档仍被拒、重写从高水位继续", async () => {
    const storage = new FakeStorage();
    const port = createWebStorageSavePort({}, storage);
    await port.write("slot_1", "一", "machine-bound");
    const older = storage.getItem("lf3-demo:slot_1");
    await port.write("slot_1", "二", "machine-bound");
    await port.remove("slot_1");
    expect(await port.list()).toEqual([]);
    await port.write("slot_1", "三", "machine-bound");
    expect((await port.list())[0]?.saveCount).toBe(3);
    storage.setItem("lf3-demo:slot_1", older ?? "{}");
    await expect(port.read("slot_1")).rejects.toThrow("回档尝试被拒绝");
  });

  it("换命名空间后读不到旧数据（键位规划由宿主自管）", async () => {
    const storage = new FakeStorage();
    await createWebStorageSavePort({}, storage).write(
      "slot_1",
      "一",
      "machine-bound",
    );
    const other = createWebStorageSavePort(
      { keyPrefix: "other:", highWaterKey: "other:hw" },
      storage,
    );
    expect(await other.list()).toEqual([]);
    await expect(other.read("slot_1")).rejects.toThrow("槽位不存在");
  });
});
