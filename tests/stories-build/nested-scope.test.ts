/**
 * 嵌套函数作用域：编译期把外层声明只读下传给内层函数体（回归）。
 *
 * 运行期 `call` 本就以「调用者当前作用域的子层」压帧，内层读外层变量沿动态链查得到；
 * 缺陷形态：编译器给每个嵌套函数一条空作用域链，凡内层引用外层参数/局部一律误报
 * 「未知标识符」。修复后：函数声明提升（嵌套名先登记，再翻译列体/函数体），嵌套函数
 * 体继承外层作用域链（参数、let、嵌套名只读下传）。
 *
 * 配套边界约定：赋值目标解析先看本层，命中外层条目的写入在构建期拦截——运行期
 * letVar 只声明进当前函数帧（外层变量原样不动），放行只会造成静默假写入。
 *
 * 断言锚点落在产物字节与真实引擎旅程（StoryEngine 起帧推进）上，走真实默认编译器。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "@lingfan-engine/stories-build";
import { SYS, StoryEngine, parseStory } from "@lingfan-engine/core";

const BASE = fileURLToPath(new URL("./.tmp-nested-scope/", import.meta.url));

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
  "name": "嵌套作用域工程",
  "entry": "start",
  "shell": { "orientation": "auto" }
}`;

/** 词汇层绑定：故事文件内直接解构（与 build-pipeline.test.ts 的 WORDS 同一形态）。 */
const WORDS = `import { script } from "@lingfan-engine/editor";
const { say } = script;

`;

interface Command {
  op: string;
  name?: string;
  params?: string[];
  target?: string;
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

function findFunc(commands: readonly Command[], name: string): Command {
  const hit = commands.find((c) => c.op === "func" && c.name === name);
  expect(hit, `产物里必须有 func ${name}`).toBeDefined();
  return hit!;
}

/** 产物单列 → 引擎可执行的完整故事，并挂错误收集 */
function runStory(
  root: string,
  rel: string,
): { engine: StoryEngine; errors: string[]; dispose: () => void } {
  const commands = readCommands(root, rel);
  const story = parseStory({
    formatVersion: 1,
    id: "start",
    entry: "start",
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

const PROBE_FILES = {
  "src/Stories.src/config.ts": config(["ch1"], "start.ts"),
  "src/Stories.src/ch1/start.ts": `${WORDS}function outer(a: string): void {
  function inner(): void {
    say(\`内层读到：\${a}\`);
  }
  inner();
}

export default function start(): void {
  outer("外层实参");
}
`,
  "Resources/project.json": MANIFEST,
};

describe("嵌套函数作用域下传（回归）", () => {
  it("拟态旅程：内层读外层参数 → 产物 func/call 形态正确，引擎念出外层实参", async () => {
    const root = makeProject("probe", PROBE_FILES);
    const report = await buildStories(root);
    expect(report.columns).toBe(1);

    const commands = readCommands(root, "ch1/start.json");
    const outer = findFunc(commands, "outer");
    expect(outer.params).toEqual(["a"]);
    const inner = outer.body!.find(
      (c) => c.op === "func" && c.name === "inner",
    );
    expect(inner?.body).toEqual([{ op: "say", text: "内层读到：{a}" }]);
    expect(outer.body!.find((c) => c.op === "call")?.target).toBe("inner");
    // 列体尾部：以实参调外层
    expect(commands[commands.length - 1]).toMatchObject({
      op: "call",
      target: "outer",
      args: ["外层实参"],
    });

    const h = runStory(root, "ch1/start.json");
    h.engine.start();
    expect(h.engine.get(SYS.currentDialogText)).toBe("内层读到：外层实参");
    expect(h.errors).toEqual([]);
    h.dispose();
  });

  it("拟态旅程：列体 let 与同层互调（嵌套函数引用列级 let、兄弟函数互调）", async () => {
    const root = makeProject("let-and-siblings", {
      "src/Stories.src/config.ts": config(["ch1"], "start.ts"),
      "src/Stories.src/ch1/start.ts": `${WORDS}export default function start(): void {
  let greeting = "你好";
  function shout(): void {
    say(\`\${greeting}，世界\`);
  }
  function announce(): void {
    shout();
  }
  announce();
}
`,
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);

    const commands = readCommands(root, "ch1/start.json");
    const shout = findFunc(commands, "shout");
    expect(shout.body).toEqual([{ op: "say", text: "{greeting}，世界" }]);
    const announce = findFunc(commands, "announce");
    expect(announce.body).toEqual([{ op: "call", target: "shout", args: [] }]);

    const h = runStory(root, "ch1/start.json");
    h.engine.start();
    expect(h.engine.get(SYS.currentDialogText)).toBe("你好，世界");
    expect(h.errors).toEqual([]);
    h.dispose();
  });

  it("拟态旅程：跨两层深链（孙层读祖父参数，链路逐级下传）", async () => {
    const root = makeProject("deep-chain", {
      "src/Stories.src/config.ts": config(["ch1"], "start.ts"),
      "src/Stories.src/ch1/start.ts": `${WORDS}function outer(tag: string): void {
  function mid(): void {
    function leaf(): void {
      say(\`深处：\${tag}\`);
    }
    leaf();
  }
  mid();
}

export default function start(): void {
  outer("根值");
}
`,
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);

    const commands = readCommands(root, "ch1/start.json");
    const mid = findFunc(commands, "outer").body!.find(
      (c) => c.op === "func" && c.name === "mid",
    );
    const leaf = mid?.body?.find((c) => c.op === "func" && c.name === "leaf");
    expect(leaf?.body).toEqual([{ op: "say", text: "深处：{tag}" }]);

    const h = runStory(root, "ch1/start.json");
    h.engine.start();
    expect(h.engine.get(SYS.currentDialogText)).toBe("深处：根值");
    expect(h.errors).toEqual([]);
    h.dispose();
  });

  it("边界：内层 let 遮蔽外层参数 —— 本层赋值写本层，外层变量原样", async () => {
    const root = makeProject("shadow", {
      "src/Stories.src/config.ts": config(["ch1"], "start.ts"),
      "src/Stories.src/ch1/start.ts": `${WORDS}function outer(label: string): void {
  function inner(): void {
    let label = "内层";
    label = "改写";
    say(label);
  }
  inner();
  say(label);
}

export default function start(): void {
  outer("外层");
}
`,
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);

    const h = runStory(root, "ch1/start.json");
    h.engine.start();
    expect(h.engine.get(SYS.currentDialogText)).toBe("改写");
    h.engine.advance();
    expect(h.engine.get(SYS.currentDialogText)).toBe("外层");
    expect(h.errors).toEqual([]);
    h.dispose();
  });

  it("故意错误：内层给外层变量赋值 ⇒ fail-closed（运行期只会假写入）且零写盘", async () => {
    const root = makeProject("cross-write", {
      "src/Stories.src/config.ts": config(["ch1"], "start.ts"),
      "src/Stories.src/ch1/start.ts": `${WORDS}function outer(count: number): void {
  function bump(): void {
    count = count + 1;
  }
  bump();
}

export default function start(): void {
  outer(1);
}
`,
      "Resources/project.json": MANIFEST,
    });

    await expect(buildStories(root)).rejects.toThrow(
      /不能在内层函数给外层变量 `count` 赋值/,
    );
    expect(() =>
      readFileSync(join(root, "Resources/Stories/ch1/start.json"), "utf8"),
    ).toThrow();
  });

  it("既有文案锚定：本外层都未命中的赋值与读取仍走原诊断（不因新分支改写）", async () => {
    const bothMiss = makeProject("both-miss", {
      "src/Stories.src/config.ts": config(["ch1"], "start.ts"),
      "src/Stories.src/ch1/start.ts": `${WORDS}function outer(): void {
  function bump(): void {
    ghost = 1;
  }
  bump();
}

export default function start(): void {
  outer();
}
`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(bothMiss)).rejects.toThrow(
      /赋值目标 `ghost` 必须是已声明的 let 局部变量/,
    );

    const unknownRead = makeProject("unknown-read", {
      "src/Stories.src/config.ts": config(["ch1"], "start.ts"),
      "src/Stories.src/ch1/start.ts": `${WORDS}function outer(): void {
  function peek(): void {
    say(\`\${ghost}\`);
  }
  peek();
}

export default function start(): void {
  outer();
}
`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(unknownRead)).rejects.toThrow(
      /未知标识符 `ghost`/,
    );
  });

  it("不变量：嵌套工程二跑幂等（added/updated/removed 全空）", async () => {
    const root = makeProject("idempotent", PROBE_FILES);
    const first = await buildStories(root);
    expect(first.added).toContain("Stories/ch1/start.json");

    const second = await buildStories(root);
    expect(second.added).toEqual([]);
    expect(second.updated).toEqual([]);
    expect(second.removed).toEqual([]);
  });

  it("边界：嵌套函数声明而未被调用 ⇒ 照常发射 func 注册，引擎零错误跑完", async () => {
    const root = makeProject("uncalled", {
      "src/Stories.src/config.ts": config(["ch1"], "start.ts"),
      "src/Stories.src/ch1/start.ts": `${WORDS}function outer(): void {
  function unused(): void {
    say("从未被调");
  }
}

export default function start(): void {
  outer();
}
`,
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);

    const commands = readCommands(root, "ch1/start.json");
    const unused = findFunc(commands, "outer").body!.find(
      (c) => c.op === "func" && c.name === "unused",
    );
    expect(unused?.body).toEqual([{ op: "say", text: "从未被调" }]);

    const h = runStory(root, "ch1/start.json");
    h.engine.start();
    expect(h.errors).toEqual([]);
    h.dispose();
  });
});
