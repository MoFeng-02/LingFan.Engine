/**
 * 原生形态挂载：控制面作为工厂第二参传下去。
 *
 * 判据是「第二条通道真的到了组件手里，而且没有混进 props」——两者混在一起的话，
 * 含函数的值会被写进 `SYS.mounts`，存档时 JSON 序列化当场炸掉，而单看界面一切正常。
 */
import { describe, expect, it } from "vitest";
import type { HostControls } from "@lingfan-engine/core";
import {
  createNativeMountRenderer,
  type NativeUiFactory,
  type NativeUiInstance,
} from "../../template/v1/__PROJECT__/src/host/mount/index";

/** 最小 DOM 节点替身：只覆盖渲染器用到的成员 */
class FakeElement {
  readonly children: FakeElement[] = [];
  parentNode: FakeElement | null = null;

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

/** 控制面替身：九方法全空实现，判据只认「同一个对象被交下去」 */
const controls: HostControls = {
  pause: () => {},
  resume: () => {},
  paused: () => false,
  pauseMedia: () => {},
  resumeMedia: () => {},
  navigate: () => {},
  save: () => {},
  load: () => {},
  dispose: () => {},
};

/** 记着每次收到哪两样东西的工厂 */
function makeFactory() {
  const received: Array<{
    props: Readonly<Record<string, unknown>>;
    controls: HostControls;
  }> = [];
  const factory: NativeUiFactory = (props, controls) => {
    received.push({ props, controls });
    const instance: NativeUiInstance = {
      element: new FakeElement() as unknown as HTMLElement,
    };
    return instance;
  };
  return { factory, received };
}

describe("原生形态：值走 props、操作走 controls", () => {
  it("工厂的第二参就是渲染器拿到的那份控制面，且重挂后仍给同一份", () => {
    const container = new FakeElement();
    const hub = makeFactory();
    const renderer = createNativeMountRenderer({
      container: container as unknown as HTMLElement,
      table: { hub: hub.factory },
      reportError: () => {},
      controls,
    });

    renderer.sync({ hub: { visible: true, props: { scene: "inn" } } });
    expect(hub.received).toHaveLength(1);
    expect(hub.received[0]?.controls).toBe(controls);

    // 入参变了会整份重挂：新实例仍应拿到同一份控制面
    renderer.sync({ hub: { visible: true, props: { scene: "forest" } } });
    expect(hub.received).toHaveLength(2);
    expect(hub.received[1]?.controls).toBe(controls);

    // props 里只有故事给的值，没有被顺手塞进去的操作句柄
    expect(Object.keys(hub.received[1]?.props ?? {})).toEqual(["scene"]);
  });

  it("只写一个参数的工厂照常工作：多出来的那个参数不是它必须接的东西", () => {
    const container = new FakeElement();
    const seen: Array<Readonly<Record<string, unknown>>> = [];
    // 老写法：只要 props，不关心操作句柄——签名的第二个参数是可忽略的
    const factory: NativeUiFactory = (props) => {
      seen.push(props);
      return { element: new FakeElement() as unknown as HTMLElement };
    };
    const renderer = createNativeMountRenderer({
      container: container as unknown as HTMLElement,
      table: { hub: factory },
      reportError: () => {},
      controls,
    });

    renderer.sync({ hub: { visible: true, props: { scene: "inn" } } });
    expect(seen).toEqual([{ scene: "inn" }]);
    expect(container.childElementCount).toBe(1);
  });
});
