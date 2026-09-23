/**
 * 08-U7 静态资源端口测试：逻辑路径 → 应用资源根 URL（不依赖工作目录）+ 路径穿越拒绝。
 */
import { describe, expect, it } from "vitest";
import { createStaticResourcePort } from "@lingfan/adapters";

describe("08-U7 资源寻址（锚点: resource-root-resolution）", () => {
  it("项目根相对逻辑路径 → 应用资源根 URL", async () => {
    const port = createStaticResourcePort();
    expect(await port.resolve("Audio/a.mp3")).toBe("/Audio/a.mp3");
    expect(await port.resolve("Video/m1.mp4")).toBe("/Video/m1.mp4");
    expect(await port.resolve("/Images/x.png")).toBe("/Images/x.png");
  });

  it("自定资源根：逻辑路径与部署位置解耦", async () => {
    const port = createStaticResourcePort("tauri://localhost/");
    expect(await port.resolve("Audio/a.mp3")).toBe(
      "tauri://localhost/Audio/a.mp3",
    );
  });

  it("路径穿越 / 空路径 / 空段一律拒绝（信任边界，不靠调用方自觉）", async () => {
    const port = createStaticResourcePort();
    for (const bad of [
      "",
      "   ",
      "..",
      "../secret.txt",
      "../../secret.txt",
      "Audio//a.mp3",
      "Audio/",
    ]) {
      await expect(port.resolve(bad)).rejects.toThrow();
    }
  });

  it("release 为空实现（静态 URL 无常驻句柄，Blob 适配器在此 revoke）", () => {
    const port = createStaticResourcePort();
    expect(() => port.release("/Audio/a.mp3")).not.toThrow();
  });
});
