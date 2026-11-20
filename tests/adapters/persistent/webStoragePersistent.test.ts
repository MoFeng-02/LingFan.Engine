/**
 * 机器级持久数据浏览器适配器：localStorage 往返、损坏隔离、缺档读空。
 *
 * 端口只做存取（JSON 序列化），字段校验降级归引擎 hydratePersistent；
 * 损坏 JSON 读 null（不抛错挡启动），与偏好/存档分键互不干扰。
 *
 * 证伪锚：损坏抛错 / 串用偏好键，本册对应例转红。
 */
import { describe, expect, it } from "vitest";
import { createWebStoragePersistentPort } from "@lingfan-engine/adapters";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string): string | null => map.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      map.set(key, value);
    },
    dump: (): Map<string, string> => map,
  };
}

describe("createWebStoragePersistentPort", () => {
  it("缺档读 null", async () => {
    const port = createWebStoragePersistentPort(fakeStorage());
    expect(await port.load()).toBeNull();
  });

  it("写入后读回往返一致", async () => {
    const port = createWebStoragePersistentPort(fakeStorage());
    await port.save({ v: 1, seen: { a: [0, 1], b: [2] } });
    expect(await port.load()).toEqual({ v: 1, seen: { a: [0, 1], b: [2] } });
  });

  it("损坏 JSON 读 null（隔离不抛错）", async () => {
    const storage = fakeStorage();
    const port = createWebStoragePersistentPort(storage);
    await port.save({ v: 1, seen: {} });
    const key = [...storage.dump().keys()][0];
    storage.setItem(key, "{corrupt");
    expect(await port.load()).toBeNull();
  });

  it("独立键空间：不与偏好键串用", async () => {
    const storage = fakeStorage();
    const port = createWebStoragePersistentPort(storage);
    await port.save({ v: 1, seen: { a: [0] } });
    const keys = [...storage.dump().keys()];
    expect(keys.some((k) => k.includes("persistent"))).toBe(true);
    expect(keys.some((k) => k.includes("prefs"))).toBe(false);
  });
});
