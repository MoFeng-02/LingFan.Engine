/**
 * 身体层 `createBodyLayer`：把 `SYS.body` 选成视图并连同环境交给渲染树。
 *
 * 这一层不碰 DOM、不碰框架：选择判据归 `selectBody`（另有专测），这里只锁
 * 「查表 → 拼入参 → 回调」与「缺名走诊断、处置后静默」这两件装配事。
 * 引擎用最小替身——本层只读 `SYS.body` 一个键，替身足以暴露转错键的错。
 */
import { describe, expect, it, vi } from "vitest";
import {
  HOST_CAPABILITY_VALUES,
  SYS,
  type SceneEnv,
  type StoryEngine,
} from "@lingfan-engine/core";
import { bodyCapabilitiesOf, createBodyLayer } from "@lingfan-engine/ui";

/** 只读本层用到的那一个键；其余键交 undefined */
function stubEngine(body: unknown): StoryEngine {
  return {
    get: (key: string): unknown => (key === SYS.body ? body : undefined),
  } as unknown as StoryEngine;
}

const ENV = {} as SceneEnv;

describe("createBodyLayer：选出身体并注入环境", () => {
  it("查表命中：视图带名字、组件与「props + env」合并入参", () => {
    const component = { setup: true };
    const onSelect = vi.fn();
    const layer = createBodyLayer({
      table: { kitchen: component },
      env: ENV,
      onError: vi.fn(),
      getEngine: () => stubEngine({ name: "kitchen", props: { mood: "dim" } }),
      onSelect,
    });
    layer.render();
    expect(onSelect).toHaveBeenCalledTimes(1);
    const view = onSelect.mock.calls[0][0];
    expect(view.name).toBe("kitchen");
    expect(view.component).toBe(component);
    expect(view.props).toEqual({ mood: "dim", env: ENV });
  });

  it("入参是新对象（不改动声明里那份），env 恒在", () => {
    const declared = { mood: "dim" };
    const onSelect = vi.fn();
    const layer = createBodyLayer({
      table: { kitchen: {} },
      env: ENV,
      onError: vi.fn(),
      getEngine: () => stubEngine({ name: "kitchen", props: declared }),
      onSelect,
    });
    layer.render();
    const view = onSelect.mock.calls[0][0];
    expect(view.props).not.toBe(declared);
    expect(declared).toEqual({ mood: "dim" });
    expect(view.props.env).toBe(ENV);
  });

  it("没写入参时入参只有 env", () => {
    const onSelect = vi.fn();
    const layer = createBodyLayer({
      table: { kitchen: {} },
      env: ENV,
      onError: vi.fn(),
      getEngine: () => stubEngine({ name: "kitchen" }),
      onSelect,
    });
    layer.render();
    expect(onSelect.mock.calls[0][0].props).toEqual({ env: ENV });
  });
});

describe("createBodyLayer：没有身体 / 脏数据交 null", () => {
  it("SYS.body 未写（undefined）：onSelect(null)，不报诊断", () => {
    const onSelect = vi.fn();
    const onError = vi.fn();
    const layer = createBodyLayer({
      table: { kitchen: {} },
      env: ENV,
      onError,
      getEngine: () => stubEngine(undefined),
      onSelect,
    });
    layer.render();
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(onError).not.toHaveBeenCalled();
  });

  it("脏数据（形状不对）：onSelect(null)，不报诊断", () => {
    const onSelect = vi.fn();
    const onError = vi.fn();
    const layer = createBodyLayer({
      table: { kitchen: {} },
      env: ENV,
      onError,
      getEngine: () => stubEngine("kitchen"),
      onSelect,
    });
    layer.render();
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("createBodyLayer：表里缺名字 fail-closed 走诊断", () => {
  it("缺名：onError 带名字与修复指引，onSelect(null) 不渲染", () => {
    const onSelect = vi.fn();
    const onError = vi.fn();
    const layer = createBodyLayer({
      table: { kitchen: {} },
      env: ENV,
      onError,
      getEngine: () => stubEngine({ name: "ghost" }),
      onSelect,
    });
    layer.render();
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toContain("ghost");
    expect(onError.mock.calls[0][0]).toContain("身体组件未注册");
  });
});

describe("createBodyLayer：不去重、处置后静默", () => {
  it("同一状态 render 两次回调两次（引用比较会留下旧身体）", () => {
    const onSelect = vi.fn();
    const layer = createBodyLayer({
      table: { kitchen: {} },
      env: ENV,
      onError: vi.fn(),
      getEngine: () => stubEngine({ name: "kitchen" }),
      onSelect,
    });
    layer.render();
    layer.render();
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("dispose 后 render 不再回调", () => {
    const onSelect = vi.fn();
    const layer = createBodyLayer({
      table: { kitchen: {} },
      env: ENV,
      onError: vi.fn(),
      getEngine: () => stubEngine({ name: "kitchen" }),
      onSelect,
    });
    layer.dispose();
    layer.render();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("createBodyLayer：宿主能力比对（body-capability-check）", () => {
  it("组件声明所需能力，宿主缺这些能力 → fail-closed 诊断 + 不渲染", () => {
    const onSelect = vi.fn();
    const onError = vi.fn();
    const component = { setup: true, capabilities: ["mount", "body"] };
    const layer = createBodyLayer({
      table: { kitchen: component },
      env: ENV,
      onError,
      getEngine: () => stubEngine({ name: "kitchen" }),
      onSelect,
      hostCapabilities: ["video", "audio", "storage", "i18n"],
    });
    layer.render();
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toContain("kitchen");
    expect(onError.mock.calls[0][0]).toContain("mount");
    expect(onError.mock.calls[0][0]).toContain("body");
  });

  it("宿主全量能力 → 组件所需恒满足，照常渲染", () => {
    const onSelect = vi.fn();
    const onError = vi.fn();
    const component = { setup: true, capabilities: ["mount", "body"] };
    const layer = createBodyLayer({
      table: { kitchen: component },
      env: ENV,
      onError,
      getEngine: () => stubEngine({ name: "kitchen" }),
      onSelect,
      hostCapabilities: HOST_CAPABILITY_VALUES,
    });
    layer.render();
    expect(onError).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].component).toBe(component);
  });

  it("组件未声明所需能力 → 不受比对影响，照常渲染", () => {
    const onSelect = vi.fn();
    const onError = vi.fn();
    const layer = createBodyLayer({
      table: { kitchen: { setup: true } },
      env: ENV,
      onError,
      getEngine: () => stubEngine({ name: "kitchen" }),
      onSelect,
      hostCapabilities: ["video"],
    });
    layer.render();
    expect(onError).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("不给 hostCapabilities → 不比对（既有行为不变）", () => {
    const onSelect = vi.fn();
    const onError = vi.fn();
    const component = { setup: true, capabilities: ["mount"] };
    const layer = createBodyLayer({
      table: { kitchen: component },
      env: ENV,
      onError,
      getEngine: () => stubEngine({ name: "kitchen" }),
      onSelect,
    });
    layer.render();
    expect(onError).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("宿主未声明任何能力（空集）→ 组件声明所需即缺，fail-closed", () => {
    const onSelect = vi.fn();
    const onError = vi.fn();
    const component = { setup: true, capabilities: ["i18n"] };
    const layer = createBodyLayer({
      table: { kitchen: component },
      env: ENV,
      onError,
      getEngine: () => stubEngine({ name: "kitchen" }),
      onSelect,
      hostCapabilities: [],
    });
    layer.render();
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toContain("i18n");
  });
});

describe("bodyCapabilitiesOf：读组件静态能力声明（capabilities-pure-data）", () => {
  it("读合法能力数组、去重、过滤词表外的值", () => {
    expect(
      bodyCapabilitiesOf({
        capabilities: ["mount", "mount", "video", "ghost"],
      }),
    ).toEqual(["mount", "video"]);
  });

  it("未声明 / 非数组 / 非对象组件 → 无所需（空集）", () => {
    expect(bodyCapabilitiesOf({})).toEqual([]);
    expect(bodyCapabilitiesOf({ capabilities: "mount" })).toEqual([]);
    expect(bodyCapabilitiesOf(null)).toEqual([]);
    expect(bodyCapabilitiesOf(undefined)).toEqual([]);
    expect(bodyCapabilitiesOf("kitchen")).toEqual([]);
  });
});
