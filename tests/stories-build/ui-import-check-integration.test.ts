/**
 * UI import 面校验接进构建整链：越界即构建失败，合规则通过。
 *
 * 单测只验判定函数，这里验的是「它真的在写盘之前被调用」——两条断言：
 * 越界 UI 的构建必须抛错且报错里有文件与行号；同一工程把越界行删掉就能构建成功。
 * 后者同时证明失败来自这一条 import，而不是工程本身有问题。
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "@lingfan-engine/stories-build";

const BASE = fileURLToPath(new URL("./.tmp-ui-import-check/", import.meta.url));

afterEach(() => {
  rmSync(BASE, { recursive: true, force: true });
});

const CONFIG =
  'export const folders = ["chapter1"];\nexport const start = "start.ts";\n';

const MANIFEST = `{
  "formatVersion": 1,
  "name": "UI import 面工程",
  "entry": "start",
  "shell": { "orientation": "auto" }
}`;

const STORY = `import { script } from "@lingfan-engine/editor";
const { say } = script;

export default function start(): void {
  say("开屏");
}
`;

/**
 * 最小工程：一条故事列 + 一个 UI 实现文件。
 * `uiSource` 就是 `src/ui/hub/hub.vue` 的全部内容——由各例决定是否越界。
 */
function makeProject(name: string, uiSource: string): string {
  const root = join(BASE, name);
  const files: Record<string, string> = {
    "src/Stories.src/config.ts": CONFIG,
    "src/Stories.src/chapter1/start.ts": STORY,
    "src/ui/hub/hub.vue": uiSource,
    "Resources/project.json": MANIFEST,
  };
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

describe("UI import 面 · 构建整链", () => {
  it("UI 反向依赖宿主 ⇒ 构建失败，报错带文件与行号", async () => {
    const root = makeProject(
      "violating",
      [
        "<template>",
        '  <div class="hub">hub</div>',
        "</template>",
        "",
        '<script setup lang="ts">',
        'import { boot } from "@/host/boot";',
        "const ready = boot;",
        "</script>",
        "",
      ].join("\n"),
    );
    const failure = await buildStories(root).then(
      () => "",
      (error: unknown) => String(error),
    );
    expect(failure).toContain("UI 文件的 import 面越界");
    expect(failure).toContain("ui/hub/hub.vue:6");
    expect(failure).toContain("@/host/boot");
    expect(failure).toContain("不得反向依赖宿主");
  });

  it("同一工程去掉越界行 ⇒ 构建成功（失败确实来自那条 import）", async () => {
    const root = makeProject(
      "clean",
      [
        "<template>",
        '  <div class="hub">hub</div>',
        "</template>",
        "",
        '<script setup lang="ts">',
        'import { ref } from "vue";',
        "const count = ref(0);",
        "</script>",
        "",
      ].join("\n"),
    );
    await expect(buildStories(root)).resolves.toBeDefined();
  });
});
