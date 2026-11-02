/**
 * 小程序储存面测试（存档 + 偏好）：假 `wx` 同步存储替身。
 * 要锁住的平台差异只有一处：微信取不存在的键返回**空串**（`localStorage` 是 null），
 * 适配器把它归一成 null；其余命名空间、高水位、列表、损坏兜底语义与 Web 实现同源。
 */
import { describe, expect, it } from "vitest";
import type { PlayerPrefsData } from "@lingfan-engine/core";
import { DEFAULT_PLAYER_PREFS } from "@lingfan-engine/core";
import type { MiniprogramStorageLike } from "@lingfan-engine/adapters";
import {
  createMiniprogramPreferencesPort,
  createMiniprogramSavePort,
  miniprogramStorageFace,
} from "@lingfan-engine/adapters";

/** 微信同步存储替身：未存的键返回空串；`putRaw` 供测试直接塞入脏值绕过适配器 */
class FakeMiniprogramStorage implements MiniprogramStorageLike {
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

describe("miniprogramStorageFace（空串 = 键不存在）", () => {
  it("未存的键 → null", () => {
    expect(
      miniprogramStorageFace(new FakeMiniprogramStorage()).getItem("k"),
    ).toBeNull();
  });

  it("存了空串也当不存在（平台层面无法区分）", () => {
    const storage = new FakeMiniprogramStorage();
    storage.putRaw("k", "");
    expect(miniprogramStorageFace(storage).getItem("k")).toBeNull();
  });

  it("写入 / 删除 / 键集透传到平台面", () => {
    const storage = new FakeMiniprogramStorage();
    const face = miniprogramStorageFace(storage);
    face.setItem("a", "1");
    expect(storage.get("a")).toBe("1");
    expect(face.getItem("a")).toBe("1");
    expect([...face.keys()]).toEqual(["a"]);
    face.removeItem("a");
    expect(storage.get("a")).toBe("");
  });
});

describe("createMiniprogramSavePort（明文档位）", () => {
  it("write → read 往返同载荷", async () => {
    const port = createMiniprogramSavePort(new FakeMiniprogramStorage());
    await port.write("slot1", '{"a":1}', "machine-bound");
    await expect(port.read("slot1")).resolves.toBe('{"a":1}');
  });

  it("槽位不存在 → 读被拒（不静默返回空载荷）", async () => {
    const port = createMiniprogramSavePort(new FakeMiniprogramStorage());
    await expect(port.read("nope")).rejects.toThrow("槽位不存在：nope");
  });

  it("高水位自管：旧计数的档被拒（防回档）", async () => {
    const storage = new FakeMiniprogramStorage();
    const port = createMiniprogramSavePort(storage);
    await port.write("slot1", "旧", "machine-bound");
    await port.write("slot1", "新", "machine-bound");
    // 把第一份记录的计数改小，模拟「拿旧数据覆盖回来」
    storage.patchRaw("lf3-demo:slot1", { saveCount: 1 });
    await expect(port.read("slot1")).rejects.toThrow("回档尝试被拒绝");
  });

  it("高水位逐槽自管：一个槽位多存几次，不影响另一个槽位的计数与可读性", async () => {
    const port = createMiniprogramSavePort(new FakeMiniprogramStorage());
    await port.write("slot1", "一", "machine-bound");
    await port.write("slot2", "二", "machine-bound");
    // 后写的槽位不影响先写的：各自计数从 1 起
    const afterBoth = await port.list();
    expect(afterBoth.map((item) => [item.slot, item.saveCount])).toEqual([
      ["slot1", 1],
      ["slot2", 1],
    ]);
    // 反复覆盖 slot1 之后，slot2 仍然读得出来（全局计数会在这里把 slot2 判成回档）
    await port.write("slot1", "一改", "machine-bound");
    await port.write("slot1", "一改再改", "machine-bound");
    await expect(port.read("slot2")).resolves.toBe("二");
    await expect(port.read("slot1")).resolves.toBe("一改再改");
  });

  it("list 只认命名空间前缀并跳过高水位键；remove 后列表清空（高水位不动）", async () => {
    const storage = new FakeMiniprogramStorage();
    const port = createMiniprogramSavePort(storage);
    storage.putRaw("页面上的其它键", "x");
    await port.write("slot1", "payload-1", "machine-bound");
    const listed = await port.list();
    expect(listed.map((item) => item.slot)).toEqual(["slot1"]);
    expect(listed[0]?.saveCount).toBe(1);
    await port.remove("slot1");
    await expect(port.list()).resolves.toEqual([]);
    // 删档不回退该槽位自己的高水位：同一槽位再写仍然递增
    await port.write("slot1", "payload-1b", "machine-bound");
    const afterRecreate = await port.list();
    expect(afterRecreate[0]?.saveCount).toBe(2);
    // 另一个槽位从 1 起，不继承别人的历史
    await port.write("slot2", "payload-2", "machine-bound");
    const afterOther = await port.list();
    expect(afterOther.map((item) => [item.slot, item.saveCount])).toEqual([
      ["slot1", 2],
      ["slot2", 1],
    ]);
  });

  it("自定义前缀：换命名空间后旧前缀的键读不到（迁移由宿主自管）", async () => {
    const storage = new FakeMiniprogramStorage();
    await createMiniprogramSavePort(storage).write(
      "slot1",
      "旧档",
      "machine-bound",
    );
    const other = createMiniprogramSavePort(storage, { keyPrefix: "lf4:" });
    await expect(other.read("slot1")).rejects.toThrow("槽位不存在");
  });
});

describe("createMiniprogramPreferencesPort（明文 JSON，坏值不挡启动）", () => {
  it("save → load 往返同值", async () => {
    const port = createMiniprogramPreferencesPort(new FakeMiniprogramStorage());
    const data: PlayerPrefsData = {
      ...DEFAULT_PLAYER_PREFS,
      volumes: { ...DEFAULT_PLAYER_PREFS.volumes, bgm: 0.25 },
      textSpeed: 75,
    };
    await port.save(data);
    await expect(port.load()).resolves.toEqual(data);
  });

  it("没存过 → null（首次启动用默认值）", async () => {
    const port = createMiniprogramPreferencesPort(new FakeMiniprogramStorage());
    await expect(port.load()).resolves.toBeNull();
  });

  it("存坏了 → null（偏好损坏不影响启动）", async () => {
    const storage = new FakeMiniprogramStorage();
    storage.putRaw("lingfan.prefs.v1", "{ not json");
    await expect(
      createMiniprogramPreferencesPort(storage).load(),
    ).resolves.toBeNull();
  });
});
