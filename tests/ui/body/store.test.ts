/**
 * 身体 store `createBodyStore`：单槽可订阅值的通路是否只有一条、退订是否干净。
 *
 * 机制复用挂载域的值格（另有其测），这里只锁身体单槽的投影语义：
 * 「没报过」与「没身体」对外都是 `null`，同引用不重复通知，退订后不再写渲染树。
 * 全部纯内存。
 */
import { describe, expect, it, vi } from "vitest";
import { createBodyStore, type BodyView } from "@lingfan-engine/ui";

function view(name: string): BodyView {
  return { name, component: { setup: true }, props: {} };
}

describe("createBodyStore：初值与投影", () => {
  it("缺省初值是 null（这一屏没有身体）", () => {
    expect(createBodyStore().snapshot()).toBeNull();
  });

  it("给了初值就读得到", () => {
    const v = view("kitchen");
    expect(createBodyStore(v).snapshot()).toBe(v);
  });

  it("set(null) 后快照是 null", () => {
    const store = createBodyStore(view("kitchen"));
    store.set(null);
    expect(store.snapshot()).toBeNull();
  });
});

describe("createBodyStore：订阅与通知", () => {
  it("订阅时不立刻回调（调用方先自己读快照）", () => {
    const store = createBodyStore(view("kitchen"));
    const listener = vi.fn();
    store.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it("set 新视图通知订阅者，交回投影后的值", () => {
    const store = createBodyStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const v = view("kitchen");
    store.set(v);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(v);
  });

  it("set(null) 通知 null（不是 undefined）", () => {
    const store = createBodyStore(view("kitchen"));
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(null);
    expect(listener).toHaveBeenCalledWith(null);
  });

  it("同一引用 set 两次只通知一次（引擎写侧整表新建，引用相同即没变）", () => {
    const store = createBodyStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const v = view("kitchen");
    store.set(v);
    store.set(v);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("退订后不再通知", () => {
    const store = createBodyStore();
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    stop();
    store.set(view("kitchen"));
    expect(listener).not.toHaveBeenCalled();
  });

  it("多个订阅者各自收到通知，退订一个不影响另一个", () => {
    const store = createBodyStore();
    const a = vi.fn();
    const b = vi.fn();
    const stopA = store.subscribe(a);
    store.subscribe(b);
    stopA();
    store.set(view("kitchen"));
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});
