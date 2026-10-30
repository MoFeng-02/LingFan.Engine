/**
 * 原生形态 UI 挂载：`SYS.mounts` → 容器子节点的差量渲染。
 *
 * 判据只认**容器里真实有几个子节点**，不认渲染器自己的账本：`mounted` 里记着而 DOM 里
 * 没有（或反过来）就是这类渲染器最典型的错，用账本断言永远看不见它。
 *
 * DOM 用最小替身（与 `tests/template/page-mount.test.ts` 同口径），不引 jsdom：
 * 这里要的是「谁是谁的孩子」，不是浏览器语义。替身实现了渲染器真正用到的那几个方法
 * ——`appendChild` / `removeChild` / `children` / `parentNode` / `childElementCount`。
 */
import { describe, expect, it, vi } from "vitest";
import {
  createNativeMountRenderer,
  resolveNativeFactory,
  type NativeUiFactory,
  type NativeUiInstance,
} from "../../template/v1/__PROJECT__/src/host/mount/index";

/** 最小 DOM 节点替身：只覆盖渲染器用到的成员 */
class FakeElement {
  readonly children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  readonly tagName: string;

  constructor(tagName = "div") {
    this.tagName = tagName;
  }

  get childElementCount(): number {
    return this.children.length;
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: FakeElement): FakeElement {
    const at = this.children.indexOf(child);
    if (at < 0) throw new Error("节点不在这里");
    this.children.splice(at, 1);
    child.parentNode = null;
    return child;
  }
}

/** 把替身塞进全局：渲染器签名吃 `HTMLElement`，替身只保证用到的成员对得上 */
function asContainer(node: FakeElement): HTMLElement {
  return node as unknown as HTMLElement;
}

/** 造一个记着「挂了什么入参、被拆过没有」的工厂 */
function makeFactory(name: string) {
  const calls: Array<Readonly<Record<string, unknown>>> = [];
  const instances: Array<NativeUiInstance & { disposed: boolean }> = [];
  const factory: NativeUiFactory = (props) => {
    calls.push(props);
    const element = new FakeElement("section");
    const instance = {
      element: element as unknown as HTMLElement,
      disposed: false,
      dispose(): void {
        instance.disposed = true;
      },
    };
    instances.push(instance);
    return instance;
  };
  return { name, factory, calls, instances };
}

describe("原生形态：显示与隐藏", () => {
  it("显示后容器里真有节点，隐藏后真移除（不是 display:none）", () => {
    const container = new FakeElement();
    const hub = makeFactory("hub");
    const renderer = createNativeMountRenderer({
      container: asContainer(container),
      table: { hub: hub.factory },
      reportError: () => {},
    });

    renderer.sync({ hub: { visible: true, props: {} } });
    expect(container.childElementCount).toBe(1);
    expect(hub.calls).toHaveLength(1);

    renderer.sync({ hub: { visible: false, props: {} } });
    // 关键：DOM 里一个子节点都不剩，且实例的 dispose 被调过
    expect(container.childElementCount).toBe(0);
    expect(hub.instances[0]?.disposed).toBe(true);
  });

  it("两个 UI 各自独立：隐藏一个不动另一个", () => {
    const container = new FakeElement();
    const hub = makeFactory("hub");
    const map = makeFactory("map");
    const renderer = createNativeMountRenderer({
      container: asContainer(container),
      table: { hub: hub.factory, map: map.factory },
      reportError: () => {},
    });

    renderer.sync({
      hub: { visible: true, props: {} },
      map: { visible: true, props: {} },
    });
    expect(container.childElementCount).toBe(2);

    renderer.sync({
      hub: { visible: true, props: {} },
      map: { visible: false, props: {} },
    });
    expect(container.childElementCount).toBe(1);
    expect(hub.instances[0]?.disposed).toBe(false);
    expect(map.instances[0]?.disposed).toBe(true);
  });
});

describe("原生形态：入参变化触发重挂", () => {
  it("props 变了就拆掉旧的、按新入参重建（整份重挂，不浅合并）", () => {
    const container = new FakeElement();
    const hub = makeFactory("hub");
    const renderer = createNativeMountRenderer({
      container: asContainer(container),
      table: { hub: hub.factory },
      reportError: () => {},
    });

    renderer.sync({ hub: { visible: true, props: { scene: "inn" } } });
    renderer.sync({ hub: { visible: true, props: { scene: "forest" } } });

    expect(hub.calls).toEqual([{ scene: "inn" }, { scene: "forest" }]);
    // 旧实例被拆、新实例在位：容器里始终只有一个子节点
    expect(hub.instances[0]?.disposed).toBe(true);
    expect(hub.instances[1]?.disposed).toBe(false);
    expect(container.childElementCount).toBe(1);
  });

  it("入参内容相同（只是键序不同）不重挂：同一份入参不重复建实例", () => {
    const container = new FakeElement();
    const hub = makeFactory("hub");
    const renderer = createNativeMountRenderer({
      container: asContainer(container),
      table: { hub: hub.factory },
      reportError: () => {},
    });

    renderer.sync({ hub: { visible: true, props: { a: 1, b: 2 } } });
    renderer.sync({ hub: { visible: true, props: { b: 2, a: 1 } } });
    expect(hub.calls).toHaveLength(1);
  });
});

describe("原生形态：取不到工厂时 fail-closed", () => {
  it("表里没有这个名字：不挂节点，报一条带名字的诊断，且不重复刷屏", () => {
    const container = new FakeElement();
    const reportError = vi.fn();
    const renderer = createNativeMountRenderer({
      container: asContainer(container),
      table: {},
      reportError,
    });

    renderer.sync({ ghost: { visible: true, props: {} } });
    renderer.sync({ ghost: { visible: true, props: {} } });

    expect(container.childElementCount).toBe(0);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(String(reportError.mock.calls[0]?.[0])).toContain("ghost");
  });

  it("表里有名字但不是函数：同样跳过并上报（原生形态的 UI 必须是工厂）", () => {
    const container = new FakeElement();
    const reportError = vi.fn();
    const renderer = createNativeMountRenderer({
      container: asContainer(container),
      table: { hub: {} },
      reportError,
    });

    renderer.sync({ hub: { visible: true, props: {} } });
    expect(container.childElementCount).toBe(0);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("工厂自己抛错：不崩整屏，报一条带名字的诊断", () => {
    const container = new FakeElement();
    const reportError = vi.fn();
    const renderer = createNativeMountRenderer({
      container: asContainer(container),
      table: {
        hub: () => {
          throw new Error("组件内部炸了");
        },
      },
      reportError,
    });

    expect(() =>
      renderer.sync({ hub: { visible: true, props: {} } }),
    ).not.toThrow();
    expect(container.childElementCount).toBe(0);
    expect(String(reportError.mock.calls[0]?.[0])).toContain("组件内部炸了");
  });
});

describe("原生形态：脏值与拆除", () => {
  it("脏值按空表：不抛，且把已挂的都卸掉", () => {
    const container = new FakeElement();
    const hub = makeFactory("hub");
    const renderer = createNativeMountRenderer({
      container: asContainer(container),
      table: { hub: hub.factory },
      reportError: () => {},
    });

    renderer.sync({ hub: { visible: true, props: {} } });
    expect(container.childElementCount).toBe(1);

    renderer.sync("这不是一张表");
    expect(container.childElementCount).toBe(0);
  });

  it("dispose 之后不再响应（晚到的状态不会往已销毁的树里写）", () => {
    const container = new FakeElement();
    const hub = makeFactory("hub");
    const renderer = createNativeMountRenderer({
      container: asContainer(container),
      table: { hub: hub.factory },
      reportError: () => {},
    });

    renderer.sync({ hub: { visible: true, props: {} } });
    renderer.dispose();
    expect(container.childElementCount).toBe(0);

    renderer.sync({ hub: { visible: true, props: {} } });
    expect(container.childElementCount).toBe(0);
    expect(hub.calls).toHaveLength(1);
  });
});

describe("resolveNativeFactory：只认函数", () => {
  it("函数原样返回，其余一律 undefined", () => {
    const factory: NativeUiFactory = () => ({
      element: new FakeElement() as unknown as HTMLElement,
    });
    expect(resolveNativeFactory({ hub: factory }, "hub")).toBe(factory);
    expect(resolveNativeFactory({ hub: {} }, "hub")).toBeUndefined();
    expect(resolveNativeFactory({}, "hub")).toBeUndefined();
  });
});
