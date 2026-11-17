/**
 * 宿主键文件归属映射测试。
 *
 * 测试要点：
 * - 面板专属：src/host/panels/<name>.ts ⇒ host/panels/<name>.json（子目录镜像）；
 * - 宿主通用：src/host/ 其余 ⇒ host/main.json；
 * - 非 host 与无法判定 ⇒ main.json 兜底（映射永不抛错）；
 * - host/ 前缀防撞名：宿主文件不与故事面派生文件（如 chapter1.json）同路径；
 * - 路径归一化：反斜杠、前导 ./、冗余分隔符判定一致。
 */
import { describe, expect, it } from "vitest";
import {
  HOST_OVERLAY_DIR,
  MAIN_OVERLAY_FILE,
  hostOverlayFile,
} from "../../packages/editor/src/i18n/host-keys.ts";

describe("hostOverlayFile · 面板专属", () => {
  it("src/host/panels/<name>.ts ⇒ host/panels/<name>.json", () => {
    expect(hostOverlayFile("src/host/panels/history.ts")).toBe(
      "host/panels/history.json",
    );
  });

  it("panels 子目录镜像保留", () => {
    expect(hostOverlayFile("src/host/panels/settings/audio.ts")).toBe(
      "host/panels/settings/audio.json",
    );
  });

  it("panels 下的非 .ts 文件不认作面板源，落宿主通用", () => {
    expect(hostOverlayFile("src/host/panels/data.json")).toBe("host/main.json");
  });
});

describe("hostOverlayFile · 宿主通用与兜底", () => {
  it("src/host/ 直属文件 ⇒ host/main.json", () => {
    expect(hostOverlayFile("src/host/toast.ts")).toBe("host/main.json");
  });

  it("src/host/ 非 panels 子目录 ⇒ host/main.json", () => {
    expect(hostOverlayFile("src/host/util/format.ts")).toBe("host/main.json");
  });

  it("名为 panels.ts 的直属文件不是面板目录 ⇒ host/main.json", () => {
    expect(hostOverlayFile("src/host/panels.ts")).toBe("host/main.json");
  });

  it("src/** 非 host ⇒ main.json", () => {
    expect(hostOverlayFile("src/main.ts")).toBe("main.json");
    expect(hostOverlayFile("src/ui/button.ts")).toBe("main.json");
  });

  it("无法判定（src 外/空串/无 src-host 相邻段）⇒ main.json，永不抛错", () => {
    expect(hostOverlayFile("scripts/build.ts")).toBe("main.json");
    expect(hostOverlayFile("")).toBe("main.json");
    expect(hostOverlayFile("host/panels/history.ts")).toBe("main.json");
    expect(hostOverlayFile("src/other/host/panels/x.ts")).toBe("main.json");
  });
});

describe("hostOverlayFile · 归一化与防撞名", () => {
  it("反斜杠、前导 ./、冗余分隔符与规范路径判定一致", () => {
    expect(hostOverlayFile("src\\host\\panels\\history.ts")).toBe(
      "host/panels/history.json",
    );
    expect(hostOverlayFile("./src/host/toast.ts")).toBe("host/main.json");
    expect(hostOverlayFile("src//host/panels/history.ts")).toBe(
      "host/panels/history.json",
    );
  });

  it("宿主文件带 host/ 前缀，不与故事面派生文件撞名", () => {
    const hostFile = hostOverlayFile("src/host/panels/chapter1.ts");
    expect(hostFile).toBe("host/panels/chapter1.json");
    expect(hostFile).not.toBe("chapter1.json");
  });

  it("导出常量与映射输出同源", () => {
    expect(MAIN_OVERLAY_FILE).toBe("main.json");
    expect(hostOverlayFile("src/host/toast.ts")).toBe(
      `${HOST_OVERLAY_DIR}/${MAIN_OVERLAY_FILE}`,
    );
  });
});
