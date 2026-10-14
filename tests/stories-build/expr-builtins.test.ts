/**
 * 表达式内建与脱糖：`?.` → optGet、`[i]` → arrayGet、`["k"]` → dictGet、len 路径长度。
 *
 * 源层是 TS 语法（引擎 lexer 无 `[]` 与 `?.`），编译器把下标/可选链降级成路径型内建
 * 文本；引擎侧路径缺失返回 null，配 `??` 兜底跑通全链。写位置与 for-of 集合不接受
 * 可选链（optGet 只读，放行只会静默丢写）；路径型内建首参不接受变量路径（路径须在
 * 构建期定型）。断言锚点落在产物字节与真实引擎旅程上，走真实默认编译器。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "@lingfan/stories-build";
import { SYS, StoryEngine, parseStory } from "@lingfan/engine";

const BASE = fileURLToPath(new URL("./.tmp-expr-builtins/", import.meta.url));

afterEach(() => {
  rmSync(BASE, { recursive: true, force: true });
});

function makeProject(name: string, files: Record<string, string>): string {
  const root = join(BASE, name);
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

const config = (folders: string[], start = "start.ts"): string =>
  `export const folders = ${JSON.stringify(folders)};\nexport const start = ${JSON.stringify(start)};\n`;

const MANIFEST = `{
  "formatVersion": 1,
  "name": "表达式内建工程",
  "entry": "start",
  "shell": { "orientation": "auto" }
}`;

/** 词汇层绑定：故事文件内直接解构（与 build-pipeline.test.ts 的 WORDS 同一形态）。 */
const WORDS = `import { script } from "@lingfan/editor";
const { say } = script;

`;

interface Command {
  op: string;
  key?: string;
  text?: string;
  value?: unknown;
  body?: Command[];
  args?: unknown[];
}

function readCommands(root: string, rel: string): Command[] {
  const text = readFileSync(join(root, "Resources/Stories", rel), "utf8");
  // 序列化产物是扁平单列文档（columns[] 包装是内存形态）
  const story = JSON.parse(text) as { id: string; commands: Command[] };
  return story.commands;
}

/** 产物单列 → 引擎可执行的完整故事（defines 即初始状态，扁平点路径键），挂错误收集 */
function runStory(
  root: string,
  rel: string,
  defines: Record<string, unknown> = {},
): { engine: StoryEngine; errors: string[]; dispose: () => void } {
  const commands = readCommands(root, rel);
  const story = parseStory({
    formatVersion: 1,
    id: "start",
    entry: "start",
    defines,
    columns: [{ id: "start", kind: "flow", commands }],
  });
  const engine = new StoryEngine(story);
  const errors: string[] = [];
  const off = engine.onEvent((e) => {
    if (e.payload.kind === "engine.error") errors.push(e.payload.code);
  });
  return {
    engine,
    errors,
    dispose: () => {
      off();
      engine.dispose();
    },
  };
}

const JOURNEY_FILES = {
  "Stories.src/config.ts": config(["ch1"], "start.ts"),
  "Stories.src/ch1/start.ts": `${WORDS}export default function start(): void {
  let nick = state.player?.nick ?? "无名";
  say(\`称呼：\${nick}\`);
  state.last = state.bag[0] ?? 0;
  say(\`首件：\${state.last}\`);
  say(\`件数：\${len(state.bag)}\`);
  say(\`速度：\${state.cfg["speed"]}\`);
  say(\`缺席：\${state.cfg["ghost"] ?? "无"}\`);
}
`,
  "Resources/project.json": MANIFEST,
};

const JOURNEY_DEFINES = {
  "player.hp": 1,
  bag: ["剑", "盾"],
  cfg: { speed: 5 },
  last: 0,
};

describe("可选链与下标脱糖（拟态旅程）", () => {
  it('?. / [i] / ["k"] / len 全链：产物形态正确，引擎逐段念出兜底与命中值', async () => {
    const root = makeProject("journey", JOURNEY_FILES);
    const report = await buildStories(root);
    expect(report.columns).toBe(1);

    const commands = readCommands(root, "ch1/start.json");
    expect(commands[0]).toMatchObject({
      op: "let",
      key: "nick",
      value: '{optGet("player.nick") ?? "无名"}',
    });
    expect(commands[1]).toMatchObject({
      op: "say",
      text: "称呼：{nick}",
    });
    expect(commands[2]).toMatchObject({
      op: "set",
      key: "last",
      value: '{arrayGet("bag", 0) ?? 0}',
    });
    expect(commands[4]?.text).toBe('件数：{len("bag")}');
    expect(commands[5]?.text).toBe('速度：{dictGet("cfg", "speed")}');
    expect(commands[6]?.text).toBe('缺席：{dictGet("cfg", "ghost") ?? "无"}');

    const h = runStory(root, "ch1/start.json", JOURNEY_DEFINES);
    h.engine.start();
    expect(h.engine.get(SYS.currentDialogText)).toBe("称呼：无名");
    h.engine.advance();
    expect(h.engine.get(SYS.currentDialogText)).toBe("首件：剑");
    h.engine.advance();
    expect(h.engine.get(SYS.currentDialogText)).toBe("件数：2");
    h.engine.advance();
    expect(h.engine.get(SYS.currentDialogText)).toBe("速度：5");
    h.engine.advance();
    expect(h.engine.get(SYS.currentDialogText)).toBe("缺席：无");
    expect(h.errors).toEqual([]);
    h.dispose();
  });

  it("不变量：二跑幂等（added/updated/removed 全空）", async () => {
    const root = makeProject("idempotent", JOURNEY_FILES);
    const first = await buildStories(root);
    expect(first.added).toContain("Stories/ch1/start.json");

    const second = await buildStories(root);
    expect(second.added).toEqual([]);
    expect(second.updated).toEqual([]);
    expect(second.removed).toEqual([]);
  });
});

describe("fail-closed：脱糖边界逐项拒绝", () => {
  it.each([
    [
      "for-of 集合可选链",
      `for (const item of state.player?.bag) {\n    say(\`\${item}\`);\n  }`,
      /for-of 集合不支持可选链：player\.bag/,
    ],
    [
      "赋值目标可选链",
      `state.player?.nick = "改写";`,
      /赋值目标不支持可选链：player\.nick/,
    ],
    [
      "路径型内建不接受变量路径",
      `let bag = 1;\n  say(\`\${len(bag)}\`);`,
      /len 首参必须是路径/,
    ],
    [
      "下标后接成员",
      `say(\`\${state.bag[0].name}\`);`,
      /成员表达式只支持 state 路径/,
    ],
    ["可选下标 ?.[]", `say(\`\${state.bag?.[0]}\`);`, /下标访问不支持可选链/],
  ])("%s ⇒ fail-closed 且零写盘", async (_label, body, pattern) => {
    const root = makeProject("reject", {
      "Stories.src/config.ts": config(["ch1"], "start.ts"),
      "Stories.src/ch1/start.ts": `${WORDS}export default function start(): void {
  ${body}
}
`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(pattern);
    expect(() =>
      readFileSync(join(root, "Resources/Stories/ch1/start.json"), "utf8"),
    ).toThrow();
  });

  it("既有文案锚定：裸未知标识符仍走原诊断（?? 不改变白名单口径）", async () => {
    const root = makeProject("unknown-ident", {
      "Stories.src/config.ts": config(["ch1"], "start.ts"),
      "Stories.src/ch1/start.ts": `${WORDS}export default function start(): void {
  say(\`\${ghost ?? 1}\`);
}
`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/未知标识符 `ghost`/);
  });
});
