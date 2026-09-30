import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "../../apps/playground/scripts/stories-build";

// 临时工程根建在项目内（vite fs.allow 覆盖；用后即删，.gitignore 防崩溃残留）
const BASE = fileURLToPath(new URL("./.tmp-build/", import.meta.url));

const VALID_SOURCE = `export default {
  formatVersion: 1,
  id: "src-demo",
  entry: "start",
  defines: { "player.gold": 7 },
  columns: [
    { id: "start", kind: "flow", commands: [
      { op: "say", text: "源文件你好" },
      { op: "menu", prompt: "去哪？", options: [{ text: "酒馆", target: "tavern" }] },
    ] },
    { id: "tavern", kind: "flow", commands: [{ op: "say", text: "到了酒馆" }] },
  ],
};
`;

const MANIFEST = `{
  "formatVersion": 1,
  "id": "demo",
  "name": "演示工程",
  "entry": "start",
  "defines": { "player.gold": 7 },
  "shell": { "orientation": "auto" }
}`;

function makeProject(name: string, files: Record<string, string>): string {
  const root = join(BASE, name);
  rmSync(root, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    const target = join(root, rel);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

afterEach(() => {
  rmSync(BASE, { recursive: true, force: true });
});

describe("stories:build · TS 故事源编译", () => {
  it("拟态旅程：合法源 → 磁盘终态（列拆分 + 清单托管键更新 + 非托管键保真）→ 再编译零差量", async () => {
    const root = makeProject("happy", {
      "Stories.src/demo.ts": VALID_SOURCE,
      "Resources/project.json": MANIFEST,
      // 手写列文件（非源产物）→ 应被当作陈旧清理
      "Resources/Stories/handwritten.json": `{"formatVersion":1,"id":"handwritten","kind":"flow","commands":[]}`,
    });

    const report = await buildStories(root);
    expect(report.storyId).toBe("src-demo");
    expect(report.columns).toBe(2);
    expect(report.written).toContain("Stories/start.json");
    expect(report.written).toContain("Stories/tavern.json");
    expect(report.written).toContain("project.json");
    expect(report.removed).toContain("Stories/handwritten.json");
    expect(existsSync(join(root, "Resources/Stories/handwritten.json"))).toBe(false);

    // 磁盘终态：列文件 = 单列原子形态；清单托管键来自源、非托管键保真
    const start = JSON.parse(readFileSync(join(root, "Resources/Stories/start.json"), "utf8"));
    expect(start).toMatchObject({ formatVersion: 1, id: "start", kind: "flow" });
    expect(JSON.stringify(start)).toContain("源文件你好");
    const manifest = JSON.parse(readFileSync(join(root, "Resources/project.json"), "utf8"));
    expect(manifest).toMatchObject({
      entry: "start",
      defines: { "player.gold": 7 },
      shell: { orientation: "auto" },
      name: "演示工程",
    });

    // 幂等：产物已最新 → 零差量
    const again = await buildStories(root);
    expect(again.written).toEqual([]);
    expect(again.removed).toEqual([]);
  });

  it("故意错误：无源 / 多源 / 缺 default / formatVersion 缺（issues 带源名）/ 列 id 重复 / 无清单 / 坏清单", async () => {
    await expect(buildStories(join(BASE, "empty"))).rejects.toThrow(/Stories\.src\/ 下没有 \.ts 源/);

    const multi = makeProject("multi", {
      "Stories.src/a.ts": VALID_SOURCE,
      "Stories.src/b.ts": VALID_SOURCE,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(multi)).rejects.toThrow(/2 个 \.ts 源.*a\.ts.*b\.ts/s);

    const noDefault = makeProject("no-default", {
      "Stories.src/demo.ts": `export const story = { formatVersion: 1 };`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(noDefault)).rejects.toThrow(/缺 default 导出/);

    const badVersion = makeProject("bad-version", {
      "Stories.src/demo.ts": `export default { id: "x", entry: "x", columns: [{ id: "x", kind: "flow", commands: [] }] };`,
      "Resources/project.json": MANIFEST,
    });
    // parseStory issues 带源名定位（Stories.src/ 前缀）——零第二套规则，报错透传
    await expect(buildStories(badVersion)).rejects.toThrow(/Stories\.src\/demo\.ts.*formatVersion/s);

    const dupColumn = makeProject("dup-column", {
      "Stories.src/demo.ts": `export default {
        formatVersion: 1, id: "x", entry: "x",
        columns: [
          { id: "same", kind: "flow", commands: [] },
          { id: "same", kind: "flow", commands: [] },
        ],
      };`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(dupColumn)).rejects.toThrow(/columnId 重复/);

    const noManifest = makeProject("no-manifest", {
      "Stories.src/demo.ts": VALID_SOURCE,
    });
    await expect(buildStories(noManifest)).rejects.toThrow(/工程清单（entry\/defines\/shell）不归 TS 源管/);

    const badManifest = makeProject("bad-manifest", {
      "Stories.src/demo.ts": VALID_SOURCE,
      "Resources/project.json": "{not-json",
    });
    await expect(buildStories(badManifest)).rejects.toThrow(/不是合法 JSON/);
  });

  it("入口指向不存在的列 → 校验链 fail-closed（错误透传，不产半套文件）", async () => {
    const root = makeProject("entry-missing", {
      "Stories.src/demo.ts": `export default {
        formatVersion: 1, id: "x", entry: "nope",
        columns: [{ id: "start", kind: "flow", commands: [] }],
      };`,
      "Resources/project.json": MANIFEST,
    });
    // 底层校验错误原样透传（不翻译不改写），消息含入口定位
    await expect(buildStories(root)).rejects.toThrow(/entry|入口/i);
    // fail-closed：零副作用（未写任何产物文件）
    expect(existsSync(join(root, "Resources/Stories"))).toBe(false);
  });
});
