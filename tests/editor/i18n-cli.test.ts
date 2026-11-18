/**
 * i18n 创作期 CLI（lingfan-i18n）编排测试。
 *
 * 测试要点（真实 fs 夹具 + 输出端口注入，不 spawn 进程）：
 * - scan：键清单 + 动态调用点 + 未标记文案，不读 overlay、不写盘；--json 形状锁定；
 * - skeleton：产物与纯函数 planOverlaySkeleton 同输入逐字节一致（互锁 L4）；
 *   幂等二跑零写入；既有译文（含空串）原样保留（互锁 L7）；孤儿默认保留、--prune 逐条列出；
 * - report：对账 + 三类诊断 + 覆盖率，--json 形状锁定；
 * - check：fail-on=missing|unused|any 的退出码语义（any = 缺译/孤儿/未标记三者任一）；
 * - 退出码：参数错误 2、IO 失败 1；三布局一致性只报告不阻断。
 */
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseStoryFile } from "@lingfan-engine/core";
import { extractStoryKeys, planOverlaySkeleton } from "@lingfan-engine/editor";
import {
  runI18nCli,
  type I18nCliOutput,
} from "../../packages/editor/src/cli/index.ts";

interface ScanJson {
  storyKeys: Record<string, string[]>;
  hostKeys: Record<string, string[]>;
  dynamic: { file: string; line: number; column: number; callee: string }[];
  unmarked: { file: string; line: number; column: number; text: string }[];
}
interface SkeletonJson {
  files: { path: string; entries: Record<string, string>; written: boolean }[];
  pruned: { path: string; keys: string[] }[];
  unplannedOrphans: { path: string; keys: string[] }[];
}
interface ReportJson {
  lang: string;
  missing: string[];
  unused: string[];
  unmarked: ScanJson["unmarked"];
  conflicts: { key: string; sites: { path: string; value: string }[] }[];
  coverage: {
    total: number;
    translated: number;
    missing: number;
    unused: number;
    ratio: number;
    weightedRatio: number;
  };
}
interface CheckJson {
  langs: { lang: string; missing: string[]; unused: string[] }[];
  unmarked: ScanJson["unmarked"];
  layoutConsistent: boolean;
  failOn: string;
  passed: boolean;
}

const STORY = JSON.stringify({
  formatVersion: 1,
  id: "start",
  entry: "a",
  columns: [
    {
      id: "a",
      kind: "flow",
      commands: [
        { op: "say", text: "你好" },
        { op: "say", text: "世界" },
      ],
    },
  ],
});
const HOST_SOURCE =
  'export const title = t("宿主键");\nexport const raw = "未标记文案";\n';

let root: string;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(tmpdir(), "lingfan-i18n-"));
});
afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  const target = path.join(root, rel);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, content, "utf8");
}

async function read(rel: string): Promise<string> {
  return fsp.readFile(path.join(root, rel), "utf8");
}

function capture(): {
  lines: string[];
  errors: string[];
  output: I18nCliOutput;
} {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    lines,
    errors,
    output: {
      log: (line) => lines.push(line),
      error: (line) => errors.push(line),
    },
  };
}

/** 最小工程形态：一个编译产物 + 一个宿主源文件（含一处未标记文案） */
async function project(): Promise<void> {
  await write("Resources/Stories/chapter1/start.json", STORY);
  await write("src/host/main.ts", HOST_SOURCE);
}

const storyKeys = new Map([["chapter1/start", ["你好", "世界"]]]);
const hostKeys = new Map([["src/host/main.ts", ["宿主键"]]]);

/* ———————————————— scan ———————————————— */

describe("scan：键清单与诊断（不写盘）", () => {
  it("文本形态：故事/宿主键计数 + 动态调用点 + 未标记文案定位", async () => {
    await project();
    const cap = capture();
    const code = await runI18nCli(["scan", root], cap.output);
    expect(code).toBe(0);
    const text = cap.lines.join("\n");
    expect(text).toContain("故事键 2 条（1 个编译产物）");
    expect(text).toContain("宿主键 1 条（1 个源文件）");
    expect(text).toContain("动态调用点 0 处");
    expect(text).toContain("src/host/main.ts:2:20 未标记文案");
    // scan 不写盘：Lang/ 不应被创建
    await expect(
      fsp.stat(path.join(root, "Resources", "Lang")),
    ).rejects.toThrow(/ENOENT/);
  });

  it("--json 形状：storyKeys/hostKeys/dynamic/unmarked", async () => {
    await project();
    await write("src/host/dyn.ts", "t(key);\n");
    const cap = capture();
    const code = await runI18nCli(["scan", root, "--json"], cap.output);
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.lines.join("\n")) as ScanJson;
    // 键序 = UTF-16 码元字典序（与 extractStoryKeys 同口径）：世(U+4E16) < 你(U+4F60)
    expect(parsed.storyKeys).toEqual({ "chapter1/start": ["世界", "你好"] });
    expect(parsed.hostKeys).toEqual({ "src/host/main.ts": ["宿主键"] });
    expect(parsed.dynamic).toEqual([
      { file: "src/host/dyn.ts", line: 1, column: 1, callee: "t" },
    ]);
    expect(parsed.unmarked).toEqual([
      { file: "src/host/main.ts", line: 2, column: 20, text: "未标记文案" },
    ]);
  });
});

/* ———————————————— skeleton（互锁 L4 / L7） ———————————————— */

describe("skeleton：写盘与增量", () => {
  it("L4：产物与 planOverlaySkeleton 同输入逐字节一致；二跑幂等零写入", async () => {
    await project();
    const cap = capture();
    const code = await runI18nCli(["skeleton", root, "--lang=en"], cap.output);
    expect(code).toBe(0);
    expect(cap.lines.join("\n")).toContain("骨架 2 个文件（写入 2，未变 0）");
    const expected = planOverlaySkeleton({
      lang: "en",
      layout: "per-story",
      storyKeys,
      hostKeys,
    });
    for (const file of expected) {
      expect(await read(path.join("Resources", file.path))).toBe(file.content);
    }
    const cap2 = capture();
    const code2 = await runI18nCli(
      ["skeleton", root, "--lang=en", "--json"],
      cap2.output,
    );
    expect(code2).toBe(0);
    const parsed = JSON.parse(cap2.lines.join("\n")) as SkeletonJson;
    expect(parsed.files.every((file) => !file.written)).toBe(true);
  });

  it("L7：既有译文（含空串）原样保留，与纯函数增量判据一致", async () => {
    await project();
    const prior = { 你好: "Hello", 世界: "" };
    await write("Resources/Lang/en/chapter1/start.json", JSON.stringify(prior));
    const code = await runI18nCli(
      ["skeleton", root, "--lang=en"],
      capture().output,
    );
    expect(code).toBe(0);
    const expected = planOverlaySkeleton({
      lang: "en",
      layout: "per-story",
      storyKeys,
      hostKeys,
      existing: new Map([["Lang/en/chapter1/start.json", prior]]),
    });
    for (const file of expected) {
      expect(await read(path.join("Resources", file.path))).toBe(file.content);
    }
    expect(
      JSON.parse(await read("Resources/Lang/en/chapter1/start.json")),
    ).toEqual(prior);
  });

  it("孤儿键默认保留；--prune 删除并逐条列出", async () => {
    await project();
    await write(
      "Resources/Lang/en/chapter1/start.json",
      JSON.stringify({ 你好: "Hello", 世界: "World", 孤儿: "Ghost" }),
    );
    await runI18nCli(["skeleton", root, "--lang=en"], capture().output);
    expect(
      JSON.parse(await read("Resources/Lang/en/chapter1/start.json")),
    ).toEqual({ 你好: "Hello", 世界: "World", 孤儿: "Ghost" });
    const cap = capture();
    const code = await runI18nCli(
      ["skeleton", root, "--lang=en", "--prune"],
      cap.output,
    );
    expect(code).toBe(0);
    const text = cap.lines.join("\n");
    expect(text).toContain("删除孤儿键 1 条（Lang/en/chapter1/start.json）：");
    expect(text).toContain("  - 孤儿");
    expect(
      JSON.parse(await read("Resources/Lang/en/chapter1/start.json")),
    ).toEqual({ 你好: "Hello", 世界: "World" });
  });

  it("single 布局：故事 + 宿主全进 Lang/{lang}.json", async () => {
    await project();
    const code = await runI18nCli(
      ["skeleton", root, "--lang=en", "--layout=single"],
      capture().output,
    );
    expect(code).toBe(0);
    const entries = JSON.parse(await read("Resources/Lang/en.json")) as Record<
      string,
      string
    >;
    expect(Object.keys(entries)).toEqual(["世界", "你好", "宿主键"]);
  });
});

/* ———————————————— skeleton：计划外孤儿文件诊断 ———————————————— */

describe("skeleton：--prune 计划外孤儿文件诊断（只报告不删除）", () => {
  it("计划外文件的孤儿键逐条列出「未删除」，文件原样保留", async () => {
    await project();
    // 故事路径 gone/old、zzz/legacy 已不存在 ⇒ 这两个 Lang 文件是计划外孤儿文件
    await write(
      "Resources/Lang/en/gone/old.json",
      JSON.stringify({ 孤儿A: "x", 孤儿B: "y" }),
    );
    await write(
      "Resources/Lang/en/zzz/legacy.json",
      JSON.stringify({ 孤儿C: "z" }),
    );
    const cap = capture();
    const code = await runI18nCli(
      ["skeleton", root, "--lang=en", "--prune"],
      cap.output,
    );
    expect(code).toBe(0);
    const text = cap.lines.join("\n");
    expect(text).toContain("3 个孤儿键位于 2 个计划外文件，--prune 未删除：");
    // 逐条 键@文件，按计划外文件路径码元序（gone < zzz）
    expect(text).toContain("  - 孤儿A@Lang/en/gone/old.json");
    expect(text).toContain("  - 孤儿B@Lang/en/gone/old.json");
    expect(text).toContain("  - 孤儿C@Lang/en/zzz/legacy.json");
    // 保守零数据丢失：计划外文件未被触碰
    expect(JSON.parse(await read("Resources/Lang/en/gone/old.json"))).toEqual({
      孤儿A: "x",
      孤儿B: "y",
    });
    expect(JSON.parse(await read("Resources/Lang/en/zzz/legacy.json"))).toEqual(
      {
        孤儿C: "z",
      },
    );
  });

  it("--json：unplannedOrphans 形状；计划内 prune 与计划外诊断并存", async () => {
    await project();
    await write(
      "Resources/Lang/en/chapter1/start.json",
      JSON.stringify({ 你好: "Hello", 世界: "World", 孤儿: "Ghost" }),
    );
    await write(
      "Resources/Lang/en/gone/old.json",
      JSON.stringify({ 孤儿A: "x" }),
    );
    const cap = capture();
    const code = await runI18nCli(
      ["skeleton", root, "--lang=en", "--prune", "--json"],
      cap.output,
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.lines.join("\n")) as SkeletonJson;
    // 计划内文件孤儿被实删（既有行为不变）
    expect(parsed.pruned).toEqual([
      { path: "Lang/en/chapter1/start.json", keys: ["孤儿"] },
    ]);
    // 计划外文件孤儿只报告不删
    expect(parsed.unplannedOrphans).toEqual([
      { path: "Lang/en/gone/old.json", keys: ["孤儿A"] },
    ]);
    expect(JSON.parse(await read("Resources/Lang/en/gone/old.json"))).toEqual({
      孤儿A: "x",
    });
  });

  it("无计划外孤儿文件时不出「未删除」诊断节", async () => {
    await project();
    const cap = capture();
    const code = await runI18nCli(
      ["skeleton", root, "--lang=en", "--prune"],
      cap.output,
    );
    expect(code).toBe(0);
    expect(cap.lines.join("\n")).not.toContain("计划外文件");
  });

  it("默认（无 --prune）不诊断计划外孤儿，孤儿键保留不变", async () => {
    await project();
    await write(
      "Resources/Lang/en/gone/old.json",
      JSON.stringify({ 孤儿A: "x" }),
    );
    const cap = capture();
    const code = await runI18nCli(["skeleton", root, "--lang=en"], cap.output);
    expect(code).toBe(0);
    expect(cap.lines.join("\n")).not.toContain("计划外文件");
    expect(JSON.parse(await read("Resources/Lang/en/gone/old.json"))).toEqual({
      孤儿A: "x",
    });
  });
});

/* ———————————————— report ———————————————— */

describe("report：对账报告（不写盘）", () => {
  it("--json 形状：missing/unused/unmarked/conflicts/coverage", async () => {
    await project();
    await write(
      "Resources/Lang/en/chapter1/start.json",
      JSON.stringify({ 你好: "Hello", 世界: "World", 孤儿: "Ghost" }),
    );
    const cap = capture();
    const code = await runI18nCli(
      ["report", root, "--lang=en", "--json"],
      cap.output,
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.lines.join("\n")) as ReportJson;
    expect(parsed.lang).toBe("en");
    expect(parsed.missing).toEqual(["宿主键"]);
    expect(parsed.unused).toEqual(["孤儿"]);
    expect(parsed.unmarked).toHaveLength(1);
    expect(parsed.conflicts).toEqual([]);
    expect(parsed.coverage.total).toBe(3);
    expect(parsed.coverage.translated).toBe(2);
  });

  it("文本形态：对账 + 诊断 + 覆盖率同源打印", async () => {
    await project();
    await write(
      "Resources/Lang/en/chapter1/start.json",
      JSON.stringify({ 你好: "Hello", 世界: "World" }),
    );
    const cap = capture();
    const code = await runI18nCli(["report", root, "--lang=en"], cap.output);
    expect(code).toBe(0);
    const text = cap.lines.join("\n");
    expect(text).toContain("[en] 缺译 1 条（运行期回退原文）：");
    expect(text).toContain("  - 宿主键");
    expect(text).toContain("宿主未标记文案 1 条");
    expect(text).toContain("布局冲突 0 处");
    expect(text).toContain("[en] 覆盖率");
  });
});

/* ———————————————— check（退出码语义） ———————————————— */

describe("check：fail-on 退出码与语言发现", () => {
  async function completeOverlays(): Promise<void> {
    await write(
      "Resources/Lang/en/chapter1/start.json",
      JSON.stringify({ 你好: "Hello", 世界: "World" }),
    );
    await write(
      "Resources/Lang/en/host/main.json",
      JSON.stringify({ 宿主键: "Host" }),
    );
  }

  it("缺译 → 1（缺省 fail-on=missing）；一致性只报告不阻断", async () => {
    await project();
    await write(
      "Resources/Lang/en/chapter1/start.json",
      JSON.stringify({ 你好: "Hello", 世界: "World" }),
    );
    const cap = capture();
    const code = await runI18nCli(["check", root], cap.output);
    expect(code).toBe(1);
    const text = cap.lines.join("\n");
    expect(text).toContain("check 失败（fail-on=missing）");
    expect(text).toContain("三布局键集合一致性：通过（只报告，不阻断）");
  });

  it("孤儿键 → fail-on=unused 给 1；缺译模式不拦孤儿", async () => {
    await project();
    await write(
      "Resources/Lang/en/chapter1/start.json",
      JSON.stringify({ 你好: "Hello", 世界: "World", 孤儿: "Ghost" }),
    );
    await write(
      "Resources/Lang/en/host/main.json",
      JSON.stringify({ 宿主键: "Host" }),
    );
    expect(
      await runI18nCli(["check", root, "--fail-on=unused"], capture().output),
    ).toBe(1);
    expect(await runI18nCli(["check", root], capture().output)).toBe(0);
  });

  it("未标记文案 → fail-on=any 给 1（三类任一）；missing 模式不拦", async () => {
    await project();
    await completeOverlays();
    expect(
      await runI18nCli(["check", root, "--fail-on=any"], capture().output),
    ).toBe(1);
    expect(await runI18nCli(["check", root], capture().output)).toBe(0);
  });

  it("全齐且无未标记 → 0；--json 带 passed/layoutConsistent/failOn", async () => {
    await write("Resources/Stories/chapter1/start.json", STORY);
    await write("src/host/main.ts", 'export const title = t("宿主键");\n');
    await completeOverlays();
    const cap = capture();
    const code = await runI18nCli(["check", root, "--json"], cap.output);
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.lines.join("\n")) as CheckJson;
    expect(parsed.passed).toBe(true);
    expect(parsed.layoutConsistent).toBe(true);
    expect(parsed.failOn).toBe("missing");
    expect(parsed.langs.map((entry) => entry.lang)).toEqual(["en"]);
    expect(cap.lines.join("\n")).not.toContain("check 失败");
  });

  it("Lang/ 为空：显式报告无 overlay，不视为失败", async () => {
    await project();
    const cap = capture();
    const code = await runI18nCli(["check", root], cap.output);
    expect(code).toBe(0);
    expect(cap.lines.join("\n")).toContain(
      "未发现任何 overlay（Lang/ 为空或不存在）",
    );
  });
});

/* ———————————————— 退出码：参数错误 / IO 失败 ———————————————— */

describe("退出码：参数错误 2 / IO 失败 1", () => {
  it("未知子命令与缺 --lang 都是参数错误（2）", async () => {
    const cap = capture();
    expect(await runI18nCli(["frobnicate", root], cap.output)).toBe(2);
    expect(cap.errors.join("\n")).toContain("未知子命令");
    const cap2 = capture();
    expect(await runI18nCli(["skeleton", root], cap2.output)).toBe(2);
    expect(cap2.errors.join("\n")).toContain("--lang");
  });

  it("非法 JSON / 非字符串值的 overlay：IO 失败（1）显式报错", async () => {
    await project();
    await write("Resources/Lang/en/chapter1/start.json", "{ 非法 JSON");
    const cap = capture();
    expect(await runI18nCli(["report", root, "--lang=en"], cap.output)).toBe(1);
    expect(cap.errors.length).toBeGreaterThan(0);
    await write(
      "Resources/Lang/en/chapter1/start.json",
      JSON.stringify({ 你好: 42 }),
    );
    const cap2 = capture();
    expect(await runI18nCli(["report", root, "--lang=en"], cap2.output)).toBe(
      1,
    );
    expect(cap2.errors.join("\n")).toContain("overlay 文件含非字符串值");
  });
});

/* ———————————————— 故事形态正规化（单列原子编译产物） ———————————————— */

describe("故事形态：单列原子编译产物经 parseStoryFile 正规化", () => {
  // 真编译产物是单列原子文件（顶层 {formatVersion,id,kind,commands}，无 columns）：
  // 不经 core 唯一解析点正规化就直喂 extractStoryKeys 会恒得 []（键全丢 ⇒
  // 真译文被误报孤儿、--prune 误删）。两种原子形态各锁一例 + 真语料逐文件互锁。
  const ATOMIC_FLOW = JSON.stringify({
    formatVersion: 1,
    id: "start",
    kind: "flow",
    commands: [
      { op: "say", text: "你好" },
      { op: "say", text: "世界" },
    ],
  });
  const ATOMIC_SCENE = JSON.stringify({
    formatVersion: 1,
    id: "hall",
    kind: "scene",
    body: { name: "hall" },
    entry: [{ op: "say", text: "欢迎光临" }],
  });

  it("flow 原子形态：键与多列 columns 形态同内容同集合", async () => {
    await write("Resources/Stories/chapter1/start.json", ATOMIC_FLOW);
    const cap = capture();
    const code = await runI18nCli(["scan", root, "--json"], cap.output);
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.lines.join("\n")) as ScanJson;
    expect(parsed.storyKeys).toEqual({ "chapter1/start": ["世界", "你好"] });
  });

  it("scene 原子形态（{entry,body}）：entry 命令同样进键集合", async () => {
    await write("Resources/Stories/hall.json", ATOMIC_SCENE);
    const cap = capture();
    const code = await runI18nCli(["scan", root, "--json"], cap.output);
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.lines.join("\n")) as ScanJson;
    expect(parsed.storyKeys).toEqual({ hall: ["欢迎光临"] });
  });

  it("原子形态 + 既有译文：skeleton --prune 不删有效键（数据丢失回归）", async () => {
    await write("Resources/Stories/chapter1/start.json", ATOMIC_FLOW);
    const prior = { 你好: "Hello", 世界: "World" };
    await write("Resources/Lang/en/chapter1/start.json", JSON.stringify(prior));
    const cap = capture();
    const code = await runI18nCli(
      ["skeleton", root, "--lang=en", "--prune", "--json"],
      cap.output,
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.lines.join("\n")) as SkeletonJson;
    expect(parsed.pruned).toEqual([]);
    expect(
      JSON.parse(await read("Resources/Lang/en/chapter1/start.json")),
    ).toEqual(prior);
  });

  it("真语料互锁：CLI 抽键 ≡ parseStoryFile + extractStoryKeys 逐文件，键集合非空", async () => {
    // 只读真语料（scan 不写盘）；宿主扫描指向不存在的目录隔离故事面
    const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
    const corpusRel = "apps/playground/Resources/Stories";
    const cap = capture();
    const code = await runI18nCli(
      [
        "scan",
        repoRoot,
        "--stories-dir",
        corpusRel,
        "--scan-dir",
        ".i18n-cli-test-empty",
        "--json",
      ],
      cap.output,
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.lines.join("\n")) as ScanJson;
    const expected: Record<string, string[]> = {};
    const corpusDir = path.join(repoRoot, corpusRel);
    const walk = async (dir: string, prefix: string): Promise<void> => {
      for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
        const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        if (entry.isDirectory()) {
          await walk(path.join(dir, entry.name), rel);
        } else if (rel.endsWith(".json")) {
          const text = await fsp.readFile(path.join(dir, entry.name), "utf8");
          expected[rel.slice(0, -".json".length)] = extractStoryKeys(
            parseStoryFile(text, rel),
          );
        }
      }
    };
    await walk(corpusDir, "");
    expect(Object.keys(expected).length).toBeGreaterThan(0);
    expect(parsed.storyKeys).toEqual(expected);
    const union = new Set(Object.values(expected).flat());
    expect(union.size).toBeGreaterThan(0);
  });
});

/* ———————————————— 别名清单显式配置（Q18：flag > 工程清单 > 缺省 t） ———————————————— */

const ALIAS_SOURCE =
  'export const title = tr("别名键");\nexport const raw = "未标记文案";\n';

/** 带别名宿主的工程：tr 未登记时「别名键」按未标记报（缺省只认 t） */
async function aliasProject(): Promise<void> {
  await write("Resources/Stories/chapter1/start.json", STORY);
  await write("src/host/main.ts", ALIAS_SOURCE);
}

describe("别名清单：--functions flag 与工程清单 i18n.functions", () => {
  it("缺省只认 t：tr 里的中文按未标记报，不隐式猜测别名", async () => {
    await aliasProject();
    const cap = capture();
    const code = await runI18nCli(["scan", root, "--json"], cap.output);
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.lines.join("\n")) as ScanJson;
    expect(parsed.hostKeys).toEqual({});
    expect(parsed.unmarked.map((u) => u.text)).toEqual([
      "别名键",
      "未标记文案",
    ]);
  });

  it("--functions=t,tr：tr 收进键集合，未标记只剩真裸文案", async () => {
    await aliasProject();
    const cap = capture();
    const code = await runI18nCli(
      ["scan", root, "--functions=t,tr", "--json"],
      cap.output,
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.lines.join("\n")) as ScanJson;
    expect(parsed.hostKeys).toEqual({ "src/host/main.ts": ["别名键"] });
    expect(parsed.unmarked.map((u) => u.text)).toEqual(["未标记文案"]);
  });

  it("工程清单 i18n.functions 被读取（无 flag 也生效）", async () => {
    await aliasProject();
    await write(
      "Resources/project.json",
      JSON.stringify({ name: "p", i18n: { functions: ["tr"] } }),
    );
    const cap = capture();
    const code = await runI18nCli(["scan", root, "--json"], cap.output);
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.lines.join("\n")) as ScanJson;
    expect(parsed.hostKeys).toEqual({ "src/host/main.ts": ["别名键"] });
  });

  it("flag 优先于清单：清单只登记 tr，flag 只登记 t ⇒ tr 按未标记报", async () => {
    await aliasProject();
    await write(
      "Resources/project.json",
      JSON.stringify({ i18n: { functions: ["tr"] } }),
    );
    const cap = capture();
    const code = await runI18nCli(
      ["scan", root, "--functions=t", "--json"],
      cap.output,
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.lines.join("\n")) as ScanJson;
    expect(parsed.hostKeys).toEqual({});
    expect(parsed.unmarked.map((u) => u.text)).toContain("别名键");
  });

  it("清单空数组 fail-closed：exit 1 + 可读报错（扫描器唯一文案源）", async () => {
    await aliasProject();
    await write(
      "Resources/project.json",
      JSON.stringify({ i18n: { functions: [] } }),
    );
    const cap = capture();
    const code = await runI18nCli(["scan", root], cap.output);
    expect(code).toBe(1);
    expect(cap.errors.join("\n")).toContain("别名清单不能为空");
  });

  it("flag 空段 fail-closed：--functions=t, 含空名 ⇒ exit 1", async () => {
    await aliasProject();
    const cap = capture();
    const code = await runI18nCli(["scan", root, "--functions=t,"], cap.output);
    expect(code).toBe(1);
    expect(cap.errors.join("\n")).toContain("别名清单含空函数名");
  });

  it("清单形状错误 fail-closed：functions 非字符串数组 ⇒ exit 1 + 点名 i18n.functions", async () => {
    await aliasProject();
    await write(
      "Resources/project.json",
      JSON.stringify({ i18n: { functions: "t,tr" } }),
    );
    const cap = capture();
    const code = await runI18nCli(["scan", root], cap.output);
    expect(code).toBe(1);
    expect(cap.errors.join("\n")).toContain("i18n.functions 必须是字符串数组");
  });

  it("check 联动：登记别名后未标记仍在 ⇒ fail-on=any 非零退出", async () => {
    await aliasProject();
    const cap = capture();
    const code = await runI18nCli(
      ["check", root, "--functions=t,tr", "--fail-on=any"],
      cap.output,
    );
    expect(code).toBe(1);
    expect(cap.lines.join("\n")).toContain("宿主未标记文案 1 条");
  });
});
