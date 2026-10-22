/**
 * 资源供给与写回链路的文案注入覆盖测试：自定义 texts 逐字出现在错误消息里，
 * 未覆盖的方法回落缺省文案（即资源供给层的既有文案）。
 */
import { describe, expect, it } from "vitest";
import {
  createFileListFileSource,
  createSourceProjectFilesPort,
  defaultResourceTexts,
  locateResourceRootFromPaths,
  type ProjectFileSource,
} from "@lingfan-engine/adapters";

/** 替身供给：只给路径与文本（file() 不参与本测试的文案路径，恒抛即可） */
function fakeSource(
  name: string,
  files: Record<string, string>,
): ProjectFileSource {
  return {
    name,
    paths: async () => Object.keys(files),
    text: async (path) => {
      const body = files[path];
      if (body === undefined) throw new Error(`缺文件：${path}`);
      return body;
    },
    file: async () => {
      throw new Error("本替身不支持 file()（文案测试只走 text）");
    },
  };
}

describe("ResourceTexts 注入", () => {
  it("缺 Stories/ 目录：自定义文案逐字出现，未传时回落缺省", async () => {
    const source = fakeSource("演示包", { "project.json": "{}" });
    await expect(
      createSourceProjectFilesPort(source).manifest(),
    ).rejects.toThrow(defaultResourceTexts.missingStoriesDir("演示包"));
    await expect(
      createSourceProjectFilesPort(source, {
        missingStoriesDir: (name) => `自定义：${name} 没有故事目录`,
      }).manifest(),
    ).rejects.toThrow(/自定义：演示包 没有故事目录/);
  });

  it("root-locate：路径取径多清单文案可覆盖", () => {
    const paths = ["A/project.json", "B/project.json"];
    // locateResourceRootFromPaths 是同步函数：直接 throw，用同步 toThrow 断言
    expect(() => locateResourceRootFromPaths(paths)).toThrow(
      defaultResourceTexts.rootLocateMultipleManifests(
        "A/project.json",
        "B/project.json",
      ),
    );
    expect(() =>
      locateResourceRootFromPaths(paths, {
        rootLocateMultipleManifests: (first, second) =>
          `自定义多清单：${first} 与 ${second}`,
      }),
    ).toThrow(/自定义多清单：A\/project\.json 与 B\/project\.json/);
  });

  it("文件取径资源端口同样接受 texts（装配不抛即视为接口面已接通）", async () => {
    const doc = new File(["甲"], "start.json", { type: "application/json" });
    Object.defineProperty(doc, "webkitRelativePath", {
      value: "工程/Resources/Stories/start.json",
    });
    await expect(
      createFileListFileSource([doc], {
        rootLocatePathsMissing: () => "自定义未找到",
      }).then((s) => s.name),
    ).resolves.toBe("Resources");
  });
});
