/**
 * 07 §三 TauriProjectFilesPort 适配器测试：invoke 契约替身（不依赖 Tauri 运行时）。
 * 契约接缝 = TauriInvoke/TauriListen 签名；Rust 侧行为在 cargo 侧测（project_files.rs），两侧各测一半。
 */
import { describe, expect, it } from "vitest";
import {
  createTauriProjectFilesPort,
  watchTauriProjectFiles,
  type TauriInvoke,
  type TauriListen,
  type TauriProjectFiles,
} from "@lingfan/adapters";

function fakeInvoke(payload: TauriProjectFiles, calls: string[]): TauriInvoke {
  return async <T>(command: string): Promise<T> => {
    calls.push(command);
    return payload as T;
  };
}

describe("createTauriProjectFilesPort（07 §三 Tauri 原生工程供给）", () => {
  it("供给清单与故事：Record → Map，负载原样透传", async () => {
    const calls: string[] = [];
    const port = createTauriProjectFilesPort(
      fakeInvoke(
        {
          manifest: { formatVersion: 1, id: "demo", entry: "start" },
          stories: { "Stories/start.json": "{}" },
        },
        calls,
      ),
    );
    expect(await port.manifest()).toEqual({
      formatVersion: 1,
      id: "demo",
      entry: "start",
    });
    const stories = await port.stories();
    expect(stories).toBeInstanceOf(Map);
    expect(stories.get("Stories/start.json")).toBe("{}");
  });

  it("单次供给共享 memo：manifest+stories 只 invoke 一次，命令名 = project_files", async () => {
    const calls: string[] = [];
    const port = createTauriProjectFilesPort(
      fakeInvoke({ manifest: {}, stories: {} }, calls),
    );
    await port.manifest();
    await port.stories();
    expect(calls).toEqual(["project_files"]);
  });

  it("invoke 失败粘滞且 fail-closed：两方法均拒绝，不降级空工程", async () => {
    const calls: string[] = [];
    const boom: TauriInvoke = async (command): Promise<never> => {
      calls.push(command);
      throw new Error("资源目录不可用");
    };
    const port = createTauriProjectFilesPort(boom);
    await expect(port.manifest()).rejects.toThrow("资源目录不可用");
    await expect(port.stories()).rejects.toThrow("资源目录不可用");
    expect(calls).toHaveLength(1); // 粘滞：失败后不再重复 invoke
  });

  it("空 stories → 空 Map（空工程组装由引擎组装器拒绝，供给层不越权）", async () => {
    const calls: string[] = [];
    const port = createTauriProjectFilesPort(
      fakeInvoke({ manifest: {}, stories: {} }, calls),
    );
    expect((await port.stories()).size).toBe(0);
  });
});

describe("watchTauriProjectFiles（07 §三.2 热重载订阅）", () => {
  it("事件触发 onChange、stop 退订、invoke 启动 Rust 监视命令（锚点: hot-reload-subscribe）", async () => {
    const commands: string[] = [];
    let handler: (() => void) | null = null;
    let unlistened = 0;
    const listenedEvents: string[] = [];
    const listen: TauriListen = async (event, h) => {
      listenedEvents.push(event);
      handler = h;
      return () => {
        unlistened += 1;
      };
    };
    const invoke: TauriInvoke = async <T>(command: string): Promise<T> => {
      commands.push(command);
      return undefined as T;
    };
    const fired: number[] = [];
    const watcher = await watchTauriProjectFiles(
      () => fired.push(1),
      listen,
      invoke,
    );
    expect(listenedEvents).toEqual(["story-changed"]);
    expect(commands).toEqual(["watch_project_files"]);
    const fire = (): void => {
      handler?.();
    };
    fire();
    fire();
    expect(fired).toHaveLength(2);
    watcher.stop();
    expect(unlistened).toBe(1);
  });
});
