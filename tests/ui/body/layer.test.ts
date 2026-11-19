/**
 * 身体层 `createBodyLayer`：把 `SYS.body` 选成视图并连同环境交给渲染树。
 *
 * 这一层不碰 DOM、不碰框架：选择判据归 `selectBody`（另有专测），这里只锁
 * 「查表 → 拼入参 → 回调」与「缺名走诊断、处置后静默」这两件装配事。
 * 引擎用最小替身——本层只读 `SYS.body` 一个键，替身足以暴露转错键的错。
 */
import { describe, expect, it, vi } from "vitest";
import { SYS, type SceneEnv, type StoryEngine } from "@lingfan-engine/core";
import { createBodyLayer } from "@lingfan-engine/ui";

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
