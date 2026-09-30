/**
 * WS dev 通道适配器测试（TS 侧）：bridge 调用按 id 路由 / 超时回退 /
 * 端口契约映射与 Tauri 适配器同形。socket 替身注入，不依赖真实 WS 服务器。
 */
import { describe, expect, it } from "vitest";
import {
  connectWsBridge,
  createWsProjectFilesPort,
  createWsSavePort,
  createWsHostPlatform,
  type WsBridge,
  type WsSocketLike,
} from "@lingfan/adapters";

/** 测试替身 WS：事件注册表 + 已发帧记录（回放由测试驱动） */
class FakeSocket implements WsSocketLike {
  private listeners = new Map<string, Array<(ev: { data?: unknown }) => void>>();
  readonly sent: string[] = [];
  closed = false;

  addEventListener(type: string, listener: (ev: { data?: unknown }) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  /** 测试驱动：触发 open（须在 connect 注册监听之后调用） */
  open(): void {
    this.emit("open", {});
  }

  /** 测试驱动：服务器回帧 */
  reply(payload: unknown): void {
    this.emit("message", { data: JSON.stringify(payload) });
  }

  fail(): void {
    this.emit("error", {});
  }

  private emit(type: string, ev: { data?: unknown }): void {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
}

describe("connectWsBridge（ws-dev-bridge-parity TS 侧）", () => {
  it("连接后调用按 id 路由：data 送达、args 原样编组", async () => {
    const sockets: FakeSocket[] = [];
    const pending = connectWsBridge({
      makeSocket: (url) => {
        const s = new FakeSocket();
        expect(url).toBe("ws://127.0.0.1:1421");
        sockets.push(s);
        return s;
      },
    });
    sockets[0].open();
    const bridge = await pending;
    const call = bridge.call<{ hello: string }>("host_platform");
    const request = JSON.parse(sockets[0].sent[0]) as {
      id: number;
      cmd: string;
      args: Record<string, unknown>;
    };
    expect(request).toEqual({ id: 1, cmd: "host_platform", args: {} });
    sockets[0].reply({ id: request.id, ok: true, data: { hello: "windows" } });
    expect(await call).toEqual({ hello: "windows" });
  });

  it("error 响应 → 拒绝并携带可读错误", async () => {
    const sockets: FakeSocket[] = [];
    const pending = connectWsBridge({
      makeSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    });
    sockets[0].open();
    const bridge = await pending;
    const call = bridge.call("save_read", { slot: "slot_1" });
    const request = JSON.parse(sockets[0].sent[0]) as { id: number; args: { slot: string } };
    expect(request.args).toEqual({ slot: "slot_1" });
    sockets[0].reply({
      id: request.id,
      ok: false,
      error: "存档不存在（槽位 slot_1）",
    });
    await expect(call).rejects.toThrow("存档不存在（槽位 slot_1）");
  });

  it("宿主未运行：open 超时 → 快速失败（close 已调用，组合根回退 web 端口）", async () => {
    const sockets: FakeSocket[] = [];
    const pending = connectWsBridge({
      timeoutMs: 20,
      makeSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    });
    await expect(pending).rejects.toThrow("连接超时");
    expect(sockets[0].closed).toBe(true);
  });
});

/** 端口测试用的脚本化假桥（不需要 socket 层） */
function fakeBridge(handler: (cmd: string, args: Record<string, unknown>) => unknown): WsBridge {
  return {
    async call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
      const result = handler(cmd, args ?? {});
      if (result instanceof Error) throw result;
      return result as T;
    },
    close(): void {},
  };
}

describe("WS 端口契约映射（与 Tauri 适配器同形）", () => {
  it("createWsProjectFilesPort：manifest 直传 + stories Record → Map", async () => {
    const port = createWsProjectFilesPort(
      fakeBridge((cmd) => {
        expect(cmd).toBe("project_files");
        return {
          manifest: { id: "demo" },
          stories: { "Stories/a.json": "{\"x\":1}", "Stories/b/c.story": "text" },
        };
      }),
    );
    expect(await port.manifest()).toEqual({ id: "demo" });
    const stories = await port.stories();
    expect(stories).toBeInstanceOf(Map);
    expect(stories.get("Stories/a.json")).toBe("{\"x\":1}");
    expect(stories.get("Stories/b/c.story")).toBe("text");
  });

  it("createWsSavePort：命令名/参数键与 invoke 契约一致 + list snake→camel", async () => {
    const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    const port = createWsSavePort(
      fakeBridge((cmd, args) => {
        calls.push({ cmd, args });
        if (cmd === "save_read") return "{}";
        if (cmd === "save_list") {
          return [
            { slot: "slot_1", save_count: 2, timestamp: 100, mode: "machine-bound" },
          ];
        }
        return cmd === "save_write"
          ? { slot: args.slot, save_count: 2, timestamp: 100, mode: args.mode }
          : undefined;
      }),
    );
    await port.write("slot_1", "{\"gold\":1}", "machine-bound");
    expect(await port.read("slot_1")).toBe("{}");
    await port.remove("slot_1");
    const list = await port.list();
    expect(list).toEqual([
      { slot: "slot_1", saveCount: 2, timestamp: 100, mode: "machine-bound" },
    ]);
    expect(calls.map((c) => c.cmd)).toEqual([
      "save_write",
      "save_read",
      "save_delete",
      "save_list",
    ]);
    expect(calls[0].args).toEqual({
      slot: "slot_1",
      payload: "{\"gold\":1}",
      mode: "machine-bound",
    });
  });

  it("createWsHostPlatform：经 WS 问宿主平台（createHostPort 的供值来源）", async () => {
    const platform = await createWsHostPlatform(
      fakeBridge((cmd) => {
        expect(cmd).toBe("host_platform");
        return "windows";
      }),
    );
    expect(platform).toBe("windows");
  });
});
