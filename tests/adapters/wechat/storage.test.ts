/**
 * 小程序储存面测试（存档 + 偏好）：假 `wx` 同步存储替身。
 * 要锁住的平台差异只有一处：微信取不存在的键返回**空串**（`localStorage` 是 null），
 * 适配器把它归一成 null；其余命名空间、高水位、列表、损坏兜底语义与 Web 实现同源。
 */
import { describe, expect, it } from "vitest";
import type { PlayerPrefsData } from "@lingfan/engine";
import { DEFAULT_PLAYER_PREFS } from "@lingfan/engine";
import type { WechatStorageLike } from "@lingfan/adapters";
import {
  createWechatPreferencesPort,
  createWechatSavePort,
  wechatStorageFace,
} from "@lingfan/adapters";

/** 微信同步存储替身：未存的键返回空串；`putRaw` 供测试直接塞入脏值绕过适配器 */
class FakeWechatStorage implements WechatStorageLike {
  private map = new Map<string, string>();

  set(key: string, value: string): void {
    this.map.set(key, value);
  }

  get(key: string): string {
    return this.map.get(key) ?? "";
  }

  remove(key: string): void {
    this.map.delete(key);
  }

  keys(): readonly string[] {
    return [...this.map.keys()];
  }

  /** 测试钩子：按原样写入，不做任何归一 */
  putRaw(key: string, value: string): void {
    this.map.set(key, value);
  }

  /** 测试钩子：改写已存记录里的字段（高水位对账用） */
  patchRaw(key: string, patch: Record<string, unknown>): void {
    const raw = this.map.get(key) ?? "{}";
    this.map.set(key, JSON.stringify({ ...JSON.parse(raw), ...patch }));
  }
}

describe("wechatStorageFace（空串 = 键不存在）", () => {
  it("未存的键 → null", () => {
    expect(wechatStorageFace(new FakeWechatStorage()).getItem("k")).toBeNull();
  });

  it("存了空串也当不存在（平台层面无法区分）", () => {
    const storage = new FakeWechatStorage();
    storage.putRaw("k", "");
    expect(wechatStorageFace(storage).getItem("k")).toBeNull();
  });

  it("写入 / 删除 / 键集透传到平台面", () => {
    const storage = new FakeWechatStorage();
    const face = wechatStorageFace(storage);
    face.setItem("a", "1");
    expect(storage.get("a")).toBe("1");
    expect(face.getItem("a")).toBe("1");
    expect([...face.keys()]).toEqual(["a"]);
    face.removeItem("a");
    expect(storage.get("a")).toBe("");
  });
});

describe("createWechatSavePort（明文档位）", () => {
  it("write → read 往返同载荷", async () => {
    const port = createWechatSavePort(new FakeWechatStorage());
    await port.write("slot1", '{"a":1}', "machine-bound");
    await expect(port.read("slot1")).resolves.toBe('{"a":1}');
  });

  it("槽位不存在 → 读被拒（不静默返回空载荷）", async () => {
    const port = createWechatSavePort(new FakeWechatStorage());
    await expect(port.read("nope")).rejects.toThrow("槽位不存在：nope");
  });

  it("高水位自管：旧计数的档被拒（防回档）", async () => {
    const storage = new FakeWechatStorage();
    const port = createWechatSavePort(storage);
    await port.write("slot1", "旧", "machine-bound");
    await port.write("slot1", "新", "machine-bound");
    // 把第一份记录的计数改小，模拟「拿旧数据覆盖回来」
    storage.patchRaw("lf3-demo:slot1", { saveCount: 1 });
    await expect(port.read("slot1")).rejects.toThrow("回档尝试被拒绝");
  });

  it("list 只认命名空间前缀并跳过高水位键；remove 后列表清空（高水位不动）", async () => {
    const storage = new FakeWechatStorage();
    const port = createWechatSavePort(storage);
    storage.putRaw("页面上的其它键", "x");
    await port.write("slot1", "payload-1", "machine-bound");
    const listed = await port.list();
    expect(listed.map((item) => item.slot)).toEqual(["slot1"]);
    expect(listed[0]?.saveCount).toBe(1);
    await port.remove("slot1");
    await expect(port.list()).resolves.toEqual([]);
    // 删档不回退高水位：下一档仍然递增
    await port.write("slot2", "payload-2", "machine-bound");
    const afterRemove = await port.list();
    expect(afterRemove[0]?.saveCount).toBe(2);
  });

  it("自定义前缀：换命名空间后旧前缀的键读不到（迁移由宿主自管）", async () => {
    const storage = new FakeWechatStorage();
    await createWechatSavePort(storage).write("slot1", "旧档", "machine-bound");
    const other = createWechatSavePort(storage, { keyPrefix: "lf4:" });
    await expect(other.read("slot1")).rejects.toThrow("槽位不存在");
  });
});

describe("createWechatPreferencesPort（明文 JSON，坏值不挡启动）", () => {
  it("save → load 往返同值", async () => {
    const port = createWechatPreferencesPort(new FakeWechatStorage());
    const data: PlayerPrefsData = {
      ...DEFAULT_PLAYER_PREFS,
      volumes: { ...DEFAULT_PLAYER_PREFS.volumes, bgm: 0.25 },
      textSpeed: 75,
    };
    await port.save(data);
    await expect(port.load()).resolves.toEqual(data);
  });

  it("没存过 → null（首次启动用默认值）", async () => {
    const port = createWechatPreferencesPort(new FakeWechatStorage());
    await expect(port.load()).resolves.toBeNull();
  });

  it("存坏了 → null（偏好损坏不影响启动）", async () => {
    const storage = new FakeWechatStorage();
    storage.putRaw("lingfan.prefs.v1", "{ not json");
    await expect(
      createWechatPreferencesPort(storage).load(),
    ).resolves.toBeNull();
  });
});
