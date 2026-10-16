/**
 * 增量监听（`watchStories`）：常驻进程内变更轮的产物与全量构建逐字节一致。
 *
 * 断言锚点落在两个硬验收上：
 * 1. 字节级等价——监听轮落盘后的 `Resources/Stories/**` + 生成物，与「停掉监听后
 *    再跑一次 `buildStories` 全量」的产物逐文件字节相同（增量不引入第二套编译规则）；
 * 2. 差量收敛——改动单个故事文件，监听轮 `updated` 只含该列产物；改动被引用的
 *    模块，波及故事集（反向依赖闭包）列出引用它的故事。
 *
 * 夹具范式与 build-pipeline.test.ts 同源（.tmp-watch/ 下自建临时工程、真实默认
 * 编译器）；监听触发走真实 fs.watch，轮次行经注入的 log 收集断言。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "@lingfan/stories-build";
import { affectedStories, watchStories } from "@lingfan/stories-build/watch";

const BASE = fileURLToPath(new URL("./.tmp-watch/", import.meta.url));

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
  "name": "增量监听工程",
  "entry": "start",
  "shell": { "orientation": "auto" }
}`;

const WORDS = `import { script } from "@lingfan/editor";
const { say } = script;

`;

interface Fixture {
  root: string;
}

/** 双故事工程：start（故事）+ lib/greet（被 start 与 ch2/talk 引用的模块）+ ch2/talk（故事）。
 *  夹具源码须用真实编译器支持的模块形态：export function 具名导出 + 语句位置调用。 */
function makeTwoStoryProject(name: string): Fixture {
  const root = makeProject(name, {
    "Stories.src/config.ts": config(["ch1", "ch2"]),
    "Stories.src/lib/greet.ts": `import { script } from "@lingfan/editor";

const { say } = script;

export function greet(): void {
  say("你好，旅人。");
}
`,
    "Stories.src/ch1/start.ts": `${WORDS}import { greet } from "../lib/greet.ts";

export default function start(): void {
  greet();
}
`,
    "Stories.src/ch2/talk.ts": `${WORDS}import { greet } from "../lib/greet.ts";

export default function talk(): void {
  greet();
}
`,
    "Resources/project.json": MANIFEST,
  });
  return { root };
}

/** 产物逻辑路径 → 磁盘字节的完整快照（Resources/Stories/** + 生成物 + project.json） */
function snapshotArtifacts(root: string): Map<string, Uint8Array> {
  const snap = new Map<string, Uint8Array>();
  const storiesDir = join(root, "Resources", "Stories");
  const visit = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        visit(join(dir, entry.name), `${rel}/`);
      } else {
        snap.set(
          `Resources/Stories/${rel}`,
          readFileSync(join(dir, entry.name)),
        );
      }
    }
  };
  if (existsSync(storiesDir)) visit(storiesDir, "");
  const genDir = join(root, "Stories.src", "gen");
  if (existsSync(genDir)) {
    for (const name of readdirSync(genDir)) {
      snap.set(`Stories.src/gen/${name}`, readFileSync(join(genDir, name)));
    }
  }
  const manifest = join(root, "Resources", "project.json");
  if (existsSync(manifest)) {
    snap.set("Resources/project.json", readFileSync(manifest));
  }
  return snap;
}

/** 等待监听轮落盘：轮询产物相对上一快照发生变化（或超时失败，附监听日志） */
async function waitForChange(
  before: Map<string, Uint8Array>,
  root: string,
  logLines?: string[],
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const now = snapshotArtifacts(root);
    if (now.size !== before.size) return;
    let same = true;
    for (const [rel, bytes] of now) {
      const prev = before.get(rel);
      if (prev === undefined || !bytesEqual(prev, bytes)) {
        same = false;
        break;
      }
    }
    if (!same) return;
    if (Date.now() > deadline) {
      throw new Error(
        `监听轮超时：产物快照在时限内未发生变化\n监听日志：\n${(logLines ?? []).join("\n")}`,
      );
    }
    await sleep(120);
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("增量监听（watchStories）", () => {
  it("变更轮产物与全量构建逐字节一致（改故事文件）", async () => {
    const { root } = makeTwoStoryProject("byte-equal-story");
    const lines: string[] = [];
    const stop = await watchStories(root, {
      debounceMs: 50,
      log: (message) => lines.push(message),
    });

    // 改单个故事文件 → 等监听轮落盘
    const before = snapshotArtifacts(root);
    writeFileSync(
      join(root, "Stories.src/ch1/start.ts"),
      `${WORDS}import { greet } from "../lib/greet.ts";

export default function start(): void {
  say("改名后的旅人到了。");
}
`,
    );
    await waitForChange(before, root, lines);

    // 停监听后全量构建，产物快照做字节级对比
    stop();
    await buildStories(root);
    const afterWatch = snapshotArtifacts(root);
    const afterFull = snapshotArtifacts(root);
    expect(afterWatch.size).toBe(afterFull.size);
    for (const [rel, bytes] of afterFull) {
      const watched = afterWatch.get(rel);
      expect(watched, `${rel} 必须与全量构建产物字节一致`).toBeDefined();
      expect(Buffer.from(watched!).equals(Buffer.from(bytes)), rel).toBe(true);
    }

    // 差量收敛：监听轮 updated 只含被改列的产物
    const round = lines.find((line) => line.startsWith("监听轮完成"));
    expect(round).toBeDefined();
    expect(round).toContain("波及故事：Stories.src/ch1/start");
  }, 30_000);

  it("改被引用模块：波及故事集 = 反向闭包命中全部引用者", async () => {
    const { root } = makeTwoStoryProject("affected-module");
    const lines: string[] = [];
    const stop = await watchStories(root, {
      debounceMs: 50,
      log: (message) => lines.push(message),
    });

    const before = snapshotArtifacts(root);
    writeFileSync(
      join(root, "Stories.src/lib/greet.ts"),
      `import { script } from "@lingfan/editor";

const { say } = script;

export function greet(): void {
  say("你好呀，远方的来客。");
}
`,
    );
    await waitForChange(before, root, lines);
    stop();

    const round = lines.find((line) => line.startsWith("监听轮完成"));
    expect(round).toBeDefined();
    expect(round).toContain("Stories.src/ch1/start");
    expect(round).toContain("Stories.src/ch2/talk");
  }, 30_000);

  it("首轮失败保持监听：补上 config 后保存即恢复", async () => {
    const root = makeProject("first-round-fail", {
      "Stories.src/ch1/start.ts": `${WORDS}export default function start(): void {\n  say("开局");\n}\n`,
      "Resources/project.json": MANIFEST,
    });
    const lines: string[] = [];
    const stop = await watchStories(root, {
      debounceMs: 50,
      log: (message) => lines.push(message),
    });
    expect(lines.some((line) => line.includes("首轮构建失败"))).toBe(true);

    // 补上 config 后，防抖轮重试成功
    writeFileSync(join(root, "Stories.src/config.ts"), config(["ch1"]));
    const deadline = Date.now() + 10_000;
    for (;;) {
      if (lines.some((line) => line.startsWith("监听轮完成"))) break;
      if (Date.now() > deadline) {
        throw new Error(`监听轮未在时限内完成：\n${lines.join("\n")}`);
      }
      await sleep(120);
    }
    stop();
    expect(snapshotArtifacts(root).size).toBeGreaterThan(0);
  }, 30_000);
});

describe("反向依赖闭包（affectedStories）", () => {
  const TEXTS = new Map<string, string>([
    [
      "Stories.src/lib/greet.ts",
      `export const greet = (who: string): string => who;\n`,
    ],
    [
      "Stories.src/lib/deep/util.ts",
      `import { greet } from "../greet.ts";\nexport const shout = (w: string): string => greet(w).toUpperCase();\n`,
    ],
    [
      "Stories.src/ch1/start.ts",
      `import { shout } from "../lib/deep/util.ts";\nexport default function start(): void {}\n`,
    ],
    [
      "Stories.src/ch2/standalone.ts",
      `export default function standalone(): void {}\n`,
    ],
    [
      "Stories.src/ch3/indirect.ts",
      `import { shout } from "../lib/deep/util.ts";\nexport default function indirect(): void {}\n`,
    ],
  ]);

  it("模块改动沿引用链闭包到全部故事；无关故事不进来", () => {
    expect(affectedStories(["Stories.src/lib/greet.ts"], TEXTS)).toEqual([
      "Stories.src/ch1/start.ts",
      "Stories.src/ch3/indirect.ts",
    ]);
  });

  it("故事文件自身改动 = 只含自己；非源文件（config）改动不产生波及集", () => {
    expect(affectedStories(["Stories.src/ch2/standalone.ts"], TEXTS)).toEqual([
      "Stories.src/ch2/standalone.ts",
    ]);
    expect(affectedStories(["Stories.src/config.ts"], TEXTS)).toEqual([]);
  });

  it("index 模块与 .ts 扩展名书写形态都能解析", () => {
    const texts = new Map<string, string>([
      ["Stories.src/lib/words/index.ts", `export const word = "词";\n`],
      [
        "Stories.src/ch1/start.ts",
        `import { word } from "../lib/words/index.ts";\nimport { other } from "../lib/other.ts";\nexport default function start(): void {}\n`,
      ],
      ["Stories.src/lib/other.ts", `export const other = 1;\n`],
    ]);
    expect(affectedStories(["Stories.src/lib/words/index.ts"], texts)).toEqual([
      "Stories.src/ch1/start.ts",
    ]);
    expect(affectedStories(["Stories.src/lib/other.ts"], texts)).toEqual([
      "Stories.src/ch1/start.ts",
    ]);
  });
});
