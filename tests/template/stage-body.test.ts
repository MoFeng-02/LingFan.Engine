/**
 * 列身体的宿主接线 `wireBodyLayer`：`SYS.body` → 容器里真实挂着哪个身体。
 *
 * 判据只认**容器里真实有几个子节点、挂的是谁**，不认接线自己的账本——账本与 DOM
 * 不一致正是这类单槽渲染器最典型的错。DOM 用最小替身（与 mount-render-native 同口径），
 * 引擎用真的：换列 / 回溯只有对着真实 `SYS.body` 写入才有意义。
 *
 * 覆盖：原生单槽挂载 / 换列整份重挂 / 回溯还原 / 框架落法（onBody 优先）/
 * 两样皆无只改状态 / 缺名与非函数 fail-closed 诊断去重 / 拆除干净。
 */
import { describe, expect, it, vi } from "vitest";
import {
  SYS,
  StoryEngine,
  parseStory,
  type HostControls,
} from "@lingfan-engine/core";
import type { SceneStageState } from "@lingfan-engine/ui";
import { wireBodyLayer } from "../../template/v1/__PROJECT__/src/host/stage-body";
import type { NativeUiFactory } from "../../template/v1/__PROJECT__/src/host/mount/index";

/** 最小 DOM 节点替身：只覆盖接线用到的成员 */
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

function asContainer(node: FakeElement): HTMLElement {
  return node as unknown as HTMLElement;
}

const STAGE: SceneStageState = {
  viewport: { width: 800, height: 600 },
  layout: {
    policy: "min",
    scaleX: 1,
    scaleY: 1,
    width: 800,
    height: 600,
    scaledWidth: 800,
    scaledHeight: 600,
    offsetX: 0,
    offsetY: 0,
  },
};

function makeControls(): HostControls {
  return {
    pause: () => {},
    resume: () => {},
    paused: () => false,
    pauseMedia: () => {},
    resumeMedia: () => {},
    navigate: () => {},
    submit: () => true,
    save: async () => {},
    load: async () => {},
    dispose: () => {},
  };
}

/** 两列各有一个身体：a→hello，b→other，换列即换身体 */
function makeEngine(): StoryEngine {
  return new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "demo",
      columns: [
        {
          id: "a",
          kind: "scene",
          body: { name: "hello", props: { greeting: "甲" } },
        },
        { id: "b", kind: "scene", body: { name: "other", props: {} } },
      ],
    }),
  );
}

/** 造一个原生工厂，记录每次挂出的实例（元素 + 拆除钩子） */
function makeFactory() {
  const created: { element: FakeElement; dispose: ReturnType<typeof vi.fn> }[] =
    [];
  const factory: NativeUiFactory = () => {
    const element = new FakeElement();
    const dispose = vi.fn();
    created.push({ element, dispose });
    return { element: asContainer(element), dispose };
  };
  return { factory, created };
}

describe("wireBodyLayer：原生单槽挂载", () => {
  it("进列后 render：容器里挂上这一列的身体", () => {
    const engine = makeEngine();
    engine.start();
    const container = new FakeElement();
    const hello = makeFactory();
    const reportError = vi.fn();
    const wiring = wireBodyLayer({
      getEngine: () => engine,
      readStage: () => STAGE,
      table: { hello: hello.factory },
      controls: makeControls(),
      reportError,
      container: asContainer(container),
    });
    expect(wiring).not.toBeNull();
    wiring!.render();
    expect(container.childElementCount).toBe(1);
    expect(container.children[0]).toBe(hello.created[0].element);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("换列整份重挂：旧的拆除并移除，新的挂上（容器始终只有一个）", () => {
    const engine = makeEngine();
    engine.start();
    const container = new FakeElement();
    const hello = makeFactory();
    const other = makeFactory();
    const wiring = wireBodyLayer({
      getEngine: () => engine,
      readStage: () => STAGE,
      table: { hello: hello.factory, other: other.factory },
      controls: makeControls(),
      reportError: vi.fn(),
      container: asContainer(container),
    })!;
    wiring.render();
    engine.navigate("b");
    wiring.render();
    expect(hello.created[0].dispose).toHaveBeenCalledTimes(1);
    expect(container.childElementCount).toBe(1);
    expect(container.children[0]).toBe(other.created[0].element);
  });

  it("回溯还原：back 回到上一检查点，身体跟着换回", () => {
    // a 是带台词的对话列（body=hello）：say 落一个检查点；b 是场景列（body=other）。
    // 进 b 后 back 回到 a 的检查点，SYS.body 还原成 hello——宿主须跟着重挂 hello。
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "demo",
        columns: [
          {
            id: "a",
            kind: "flow",
            body: { name: "hello", props: { greeting: "甲" } },
            commands: [{ op: "say", text: "甲屏的话" }],
          },
          { id: "b", kind: "scene", body: { name: "other", props: {} } },
        ],
      }),
    );
    engine.start();
    const container = new FakeElement();
    const hello = makeFactory();
    const other = makeFactory();
    const wiring = wireBodyLayer({
      getEngine: () => engine,
      readStage: () => STAGE,
      table: { hello: hello.factory, other: other.factory },
      controls: makeControls(),
      reportError: vi.fn(),
      container: asContainer(container),
    })!;
    wiring.render();
    engine.navigate("b");
    wiring.render();
    expect(container.children[0]).toBe(other.created[0].element);
    engine.back();
    wiring.render();
    expect(engine.get(SYS.body)).toEqual({
      name: "hello",
      props: { greeting: "甲" },
    });
    expect(container.childElementCount).toBe(1);
    // 回溯后重挂的是 hello（新实例），不是留着 other
    expect(container.children[0]).toBe(
      hello.created[hello.created.length - 1].element,
    );
    expect(other.created[0].dispose).toHaveBeenCalled();
  });

  it("dispose 拆掉已挂身体；此后 render 不再写容器", () => {
    const engine = makeEngine();
    engine.start();
    const container = new FakeElement();
    const hello = makeFactory();
    const wiring = wireBodyLayer({
      getEngine: () => engine,
      readStage: () => STAGE,
      table: { hello: hello.factory },
      controls: makeControls(),
      reportError: vi.fn(),
      container: asContainer(container),
    })!;
    wiring.render();
    wiring.dispose();
    expect(hello.created[0].dispose).toHaveBeenCalledTimes(1);
    expect(container.childElementCount).toBe(0);
    wiring.render();
    expect(container.childElementCount).toBe(0);
  });
});

describe("wireBodyLayer：框架落法与缺省", () => {
  it("给了 onBody：只交视图，不碰容器", () => {
    const engine = makeEngine();
    engine.start();
    const container = new FakeElement();
    const onBody = vi.fn();
    const wiring = wireBodyLayer({
      getEngine: () => engine,
      readStage: () => STAGE,
      table: { hello: {} },
      controls: makeControls(),
      reportError: vi.fn(),
      container: asContainer(container),
      onBody,
    })!;
    wiring.render();
    expect(onBody).toHaveBeenCalledTimes(1);
    const view = onBody.mock.calls[0][0];
    expect(view.name).toBe("hello");
    expect(view.props.greeting).toBe("甲");
    expect(view.props.env).toBe(wiring.env);
    expect(container.childElementCount).toBe(0);
  });

  it("容器与 onBody 皆无：返回 null（body 只改状态）", () => {
    const engine = makeEngine();
    engine.start();
    const wiring = wireBodyLayer({
      getEngine: () => engine,
      readStage: () => STAGE,
      table: { hello: {} },
      controls: makeControls(),
      reportError: vi.fn(),
    });
    expect(wiring).toBeNull();
  });
});

describe("wireBodyLayer：fail-closed 诊断", () => {
  it("表里缺名字：走诊断、容器为空", () => {
    const engine = makeEngine();
    engine.start();
    const container = new FakeElement();
    const reportError = vi.fn();
    const wiring = wireBodyLayer({
      getEngine: () => engine,
      readStage: () => STAGE,
      table: {},
      controls: makeControls(),
      reportError,
      container: asContainer(container),
    })!;
    wiring.render();
    expect(container.childElementCount).toBe(0);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0]).toContain("身体组件未注册");
    expect(reportError.mock.calls[0][0]).toContain("hello");
  });

  it("表项不是函数：报「找不到身体的工厂」，同名诊断只报一次", () => {
    const engine = makeEngine();
    engine.start();
    const container = new FakeElement();
    const reportError = vi.fn();
    const wiring = wireBodyLayer({
      getEngine: () => engine,
      readStage: () => STAGE,
      table: { hello: { notAFactory: true } },
      controls: makeControls(),
      reportError,
      container: asContainer(container),
    })!;
    wiring.render();
    wiring.render();
    expect(container.childElementCount).toBe(0);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0]).toContain("找不到身体的工厂");
  });

  it("工厂抛错：报「挂载失败」，不黑屏不吞错", () => {
    const engine = makeEngine();
    engine.start();
    const container = new FakeElement();
    const reportError = vi.fn();
    const wiring = wireBodyLayer({
      getEngine: () => engine,
      readStage: () => STAGE,
      table: {
        hello: () => {
          throw new Error("炸了");
        },
      },
      controls: makeControls(),
      reportError,
      container: asContainer(container),
    })!;
    wiring.render();
    expect(container.childElementCount).toBe(0);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0]).toContain("挂载失败");
  });
});
