/**
 * 小程序资源端口测试：包内资源直接拼包根，用户目录文件经文件面换地址。
 * 路径规范化与 Web/加密/目录句柄实现共用同一份（拒绝空段与 `..` 逃逸），这里锁住两条来源的分支。
 */
import { describe, expect, it } from "vitest";
import type { WechatFileSystemLike } from "@lingfan/adapters";
import { createWechatResourcePort } from "@lingfan/adapters";

/** 用户目录文件面替身：只认登记过的路径，`url` 造地址并记账，`release` 记账 */
class FakeFileSystem implements WechatFileSystemLike {
  private known = new Set<string>();
  /** 已发过的地址 → 释放调用次数 */
  readonly released = new Map<string, number>();

  /** 测试钩子：声明用户目录里有这个文件 */
  add(path: string): void {
    this.known.add(path);
  }

  exists(path: string): boolean {
    return this.known.has(path);
  }

  url(path: string): string {
    return `wxfile://${path}`;
  }

  release(url: string): void {
    this.released.set(url, (this.released.get(url) ?? 0) + 1);
  }
}

describe("createWechatResourcePort（包内 + 用户目录两条来源）", () => {
  it("不给文件面 → 一律走包根（纯包内故事）", async () => {
    const port = createWechatResourcePort();
    await expect(port.resolve("Audio/bgm.mp3")).resolves.toBe("/Audio/bgm.mp3");
  });

  it("前导斜杠被剥掉（逻辑路径与部署位置解耦）", async () => {
    const port = createWechatResourcePort();
    await expect(port.resolve("/Audio/bgm.mp3")).resolves.toBe(
      "/Audio/bgm.mp3",
    );
  });

  it("用户目录命中 → 换取可访问地址", async () => {
    const fileSystem = new FakeFileSystem();
    fileSystem.add("usr/Downloaded/extra.mp3");
    const port = createWechatResourcePort(fileSystem);
    await expect(port.resolve("Downloaded/extra.mp3")).resolves.toBe(
      "wxfile://usr/Downloaded/extra.mp3",
    );
  });

  it("用户目录没有 → 回落到包内路径", async () => {
    const fileSystem = new FakeFileSystem();
    const port = createWechatResourcePort(fileSystem);
    await expect(port.resolve("Audio/bgm.mp3")).resolves.toBe("/Audio/bgm.mp3");
  });

  it("release 转发给文件面（只有它自己发过的地址需要回收）", () => {
    const fileSystem = new FakeFileSystem();
    const port = createWechatResourcePort(fileSystem);
    port.release("wxfile://usr/Downloaded/extra.mp3");
    port.release("/Audio/bgm.mp3");
    expect(fileSystem.released.get("wxfile://usr/Downloaded/extra.mp3")).toBe(
      1,
    );
    // 包内地址也照样转发：由文件面自己忽略不认识的地址（契约写在端口注释里）
    expect(fileSystem.released.get("/Audio/bgm.mp3")).toBe(1);
  });

  it("非法路径被拒：空路径 / 空段 / `..` 逃逸（不靠调用方自觉）", async () => {
    const port = createWechatResourcePort();
    await expect(port.resolve("")).rejects.toThrow("资源路径为空");
    await expect(port.resolve("Audio//bgm.mp3")).rejects.toThrow(
      "资源路径非法",
    );
    await expect(port.resolve("../secret.mp3")).rejects.toThrow("资源路径非法");
  });

  it("自定义两个根：包根与用户目录根都可覆盖", async () => {
    const fileSystem = new FakeFileSystem();
    fileSystem.add("user/a.mp3");
    const port = createWechatResourcePort(fileSystem, {
      packageRoot: "assets/",
      userRoot: "user/",
    });
    await expect(port.resolve("a.mp3")).resolves.toBe("wxfile://user/a.mp3");
    await expect(port.resolve("b.mp3")).resolves.toBe("assets/b.mp3");
  });
});
