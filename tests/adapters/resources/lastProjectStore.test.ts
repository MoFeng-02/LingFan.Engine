/**
 * 「记住上次工程」测试：IndexedDB 句柄持久化（全静默降级）+ 组合根接线互锁。
 *
 * 测试要点：
 * - 拟态旅程：save → 新 store 实例 load（= 下次启动）取回同一句柄
 * - 故意错误：无 IDB / open 失败 / get 抛 → 一律 undefined，**零抛**（功能退化为不存在）
 * - 边界：非目录形状的存值被拒（load undefined）
 * - 源码互锁：宿主装配（remember/启动 load）与按钮/文案在位
 */

import { describe, expect, it } from "vitest";
import {
  createLastProjectStore,
  type LastProjectHandleStore,
} from "@lingfan/adapters";
import appSource from "../../../apps/editor/src/App.vue?raw";
import mainSource from "../../../apps/editor/src/main.ts?raw";

/** 目录句柄替身（组合根只读 name + 传引用；IDB 存取不深究内部） */
function fakeHandle(name: string): FileSystemDirectoryHandle {
  return { kind: "directory", name } as unknown as FileSystemDirectoryHandle;
}

/** 最小 IndexedDB 替身：事件模型 + 内存 Map（跨 open 共享，够 createLastProjectStore 的面） */
function makeMemoryIdbFactory(options?: {
  failOpen?: boolean;
}): IDBFactory {
  const maps = new Map<string, Map<string, unknown>>(); // store 名 → 数据（跨 open 共享）
  class FakeRequest {
    result: unknown = undefined;
    error: DOMException | null = null;
    onsuccess: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onupgradeneeded: (() => void) | null = null;
    onblocked: (() => void) | null = null;
  }
  class FakeStore {
    constructor(
      private map: Map<string, unknown>,
      private tx: FakeTx,
    ) {}
    get(key: string): FakeRequest {
      const request = new FakeRequest();
      queueMicrotask(() => {
        if (this.map.has(key)) request.result = this.map.get(key);
        request.onsuccess?.();
        this.tx.settle();
      });
      return request;
    }
    put(value: unknown, key: string): FakeRequest {
      const request = new FakeRequest();
      queueMicrotask(() => {
        this.map.set(key, value);
        request.result = key;
        request.onsuccess?.();
        this.tx.settle();
      });
      return request;
    }
  }
  class FakeTx {
    oncomplete: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    private pending = 0;
    objectStore(name: string): FakeStore {
      this.pending += 1;
      let map = maps.get(name);
      if (map === undefined) {
        map = new Map();
        maps.set(name, map);
      }
      return new FakeStore(map, this);
    }
    /** 请求全部落地后提交（IDB 语义：无 pending 请求即 complete） */
    settle(): void {
      this.pending -= 1;
      if (this.pending <= 0) this.oncomplete?.();
    }
  }
  class FakeDb {
    objectStoreNames = { contains: (name: string) => maps.has(name) };
    createObjectStore(name: string): unknown {
      const map = new Map<string, unknown>();
      maps.set(name, map);
      return { name };
    }
    transaction(name: string, mode?: string): FakeTx {
      void name;
      void mode;
      return new FakeTx();
    }
    close(): void {}
  }
  return {
    open(name: string, version?: number): unknown {
      void name;
      void version;
      const request = new FakeRequest();
      if (options?.failOpen === true) {
        queueMicrotask(() => {
          request.error = new DOMException("blocked", "InvalidStateError");
          request.onerror?.();
        });
        return request as unknown as IDBOpenDBRequest;
      }
      request.result = new FakeDb();
      queueMicrotask(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}

describe("createLastProjectStore（句柄持久化）", () => {
  it("拟态旅程：save 后新 store 实例 load 取回同一句柄", async () => {
    const factory = makeMemoryIdbFactory();
    const handle = fakeHandle("Resources");
    await createLastProjectStore(factory).save(handle);
    const loaded = await createLastProjectStore(factory).load();
    expect(loaded?.name).toBe("Resources");
    expect(loaded).toBe(handle); // IDB 结构化克隆语义下真实浏览器返回克隆；替身直传引用
  });

  it("空库 load → undefined", async () => {
    const loaded = await createLastProjectStore(makeMemoryIdbFactory()).load();
    expect(loaded).toBeUndefined();
  });

  it("显式无 IDB（undefined factory）→ load undefined、save 零抛", async () => {
    const store = createLastProjectStore(undefined);
    await expect(store.load()).resolves.toBeUndefined();
    await expect(store.save(fakeHandle("x"))).resolves.toBeUndefined();
  });

  it("open 失败（onerror）→ 静默降级：load undefined、save 不抛", async () => {
    const store = createLastProjectStore(makeMemoryIdbFactory({ failOpen: true }));
    await expect(store.load()).resolves.toBeUndefined();
    await expect(store.save(fakeHandle("x"))).resolves.toBeUndefined();
  });

  it("非目录形状的存值 → load 拒绝（undefined），不外溢坏句柄", async () => {
    const store: LastProjectHandleStore = createLastProjectStore(
      makeMemoryIdbFactory(),
    );
    await store.save({ kind: "file", name: "bogus" } as unknown as FileSystemDirectoryHandle);
    await expect(store.load()).resolves.toBeUndefined();
  });
});

describe("源码互锁：组合根装配与宿主按钮在位", () => {
  it("main.ts：IDB store 装配、成功打开后 remember、启动时 load 填充", () => {
    expect(mainSource).toContain("createLastProjectStore()");
    expect(mainSource).toContain("rememberHandle(handle)");
    expect(mainSource).toContain("lastProjectStore.load()");
    expect(mainSource).toContain("lastProjectEntryFor(handle)");
  });

  it("App.vue：一键重开按钮（有句柄才渲染）与失败文案归一", () => {
    // 按钮**文案**从「重新打开上次工程」改为 `↺` 图标
    //   （顶栏瘦身；完整说明移到 `title`，这是 tooltip 的正确用法）。
    //   本断言守的是「一键重开入口存在 + 有句柄才渲染」，**不是**那句长文案。
    expect(appSource).toContain("一键重开上次工程");
    expect(appSource).toContain("reopenLastProject");
    expect(appSource).toContain('v-if="props.lastProject?.value !== undefined"');
    expect(appSource).toContain("重新打开失败：");
  });
});