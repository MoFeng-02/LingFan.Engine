/**
 * 编辑器诊断接线：**供给侧 → `analyzeStory`** 全链拟态旅程。
 *
 * 被验证的链路（与 `apps/editor/src/main.ts` 组合根逐字同构）：
 * 目录 input 文件表 → `createFileListFileSource` → `createSourceProjectFilesPort`
 * → `loadProject`（引擎组装） → `loadDiagnosticSupply`（供给：资源文件集 + overlay 键并集）
 * → `analyzeStory(story, supply)`。
 *
 * 覆盖五类：拟态用户旅程（打开工程前/后）、故意错误注入（坏 JSON、
 * 缺资源）、边界（无 `Lang/`、加密 `.enc`、加密 overlay）、混沌游走（种子化随机往返）、
 * 回归（未接供给 = 两族诊断恒为 0，防止"接线回到未接状态"）。
 *
 * 锚定：编辑器诊断接线与资源检查
 */
import { describe, expect, it } from "vitest";
import {
  createFileListFileSource,
  createSourceProjectFilesPort,
  loadDiagnosticSupply,
  loadProject,
} from "@lingfan/adapters";
import { analyzeStory, getAtPointer, type AnalyzeOptions } from "@lingfan/editor";
import type { Story } from "@lingfan/engine";

type Tree = { [name: string]: Tree | string };

/** 目录树 → `<input webkitdirectory>` 的文件表（首段 = 用户选中的目录名） */
function filesUnder(folder: string, tree: Tree): File[] {
  const out: File[] = [];
  const walk = (prefix: string, node: Tree): void => {
    for (const [name, value] of Object.entries(node)) {
      const path = `${prefix}/${name}`;
      if (typeof value === "string") {
        const file = new File([value], name);
        Object.defineProperty(file, "webkitRelativePath", { value: path });
        out.push(file);
      } else {
        walk(path, value);
      }
    }
  };
  walk(folder, tree);
  return out;
}

const MANIFEST = JSON.stringify({ formatVersion: 1, id: "demo", entry: "start" });

/** 最小合法资源根（单列 flow；命令由用例给） */
function projectTree(parts: {
  commands: readonly unknown[];
  lang?: Tree;
  resources?: Tree;
}): Tree {
  const tree: Tree = {
    "project.json": MANIFEST,
    Stories: {
      "start.json": JSON.stringify({
        formatVersion: 1,
        id: "start",
        kind: "flow",
        commands: parts.commands,
      }),
    },
    ...(parts.resources ?? {}),
  };
  if (parts.lang !== undefined) tree.Lang = parts.lang;
  return tree;
}

/** 组合根同构链：文件表 → 组装故事 + 诊断供给侧 */
async function openProject(
  tree: Tree,
): Promise<{ story: Story; supply: Required<AnalyzeOptions> }> {
  const source = await createFileListFileSource(filesUnder("Resources", tree));
  const story = await loadProject(createSourceProjectFilesPort(source));
  return { story, supply: await loadDiagnosticSupply(source) };
}

/** 指定诊断码 → 排序后的报文主体（剥掉「前缀：」与「（说明…）」），便于精确断言 */
function messagesOf(
  story: Story,
  code: string,
  options?: AnalyzeOptions,
): string[] {
  return analyzeStory(story, options)
    .filter((d) => d.code === code)
    .map((d) =>
      d.message
        .replace(/^.*?：/, "") // 剥「未使用的译文键：」「资源路径不存在：」等前缀
        .replace(/（.*$/, "") // 剥尾部说明括注
        .trim(),
    )
    .sort();
}

describe("编辑器诊断接线", () => {
  const journeyTree = (): Tree =>
    projectTree({
      commands: [
        { op: "say", text: "你好" },
        { op: "say", text: "第二句", voice: "Audio/ok.mp3" },
        { op: "say", text: "缺语音", voice: "Audio/missing.mp3" },
      ],
      resources: { Audio: { "ok.mp3": "bytes" } },
      lang: {
        "zh-CN": {
          "main.json": JSON.stringify({ 你好: "你好", 第二句: "第二句", 孤儿键: "x" }),
        },
        "en-US.json": JSON.stringify({ 你好: "Hello", "en 专属死键": "y" }),
      },
    });

  it("未接供给（未打开工程）：资源缺失 / 未使用译文两族诊断恒为 0", async () => {
    const { story } = await openProject(journeyTree());
    expect(analyzeStory(story)).toEqual([]); // 供给未接入时**不误报**（回归）
  });

  it("拟态旅程：打开工程后两个检查器同时生效，且报文/定位精确", async () => {
    const { story, supply } = await openProject(journeyTree());
    const diagnostics = analyzeStory(story, supply);

    // 资源缺失：只有 Audio/missing.mp3（pointer 指向该 voice 字段；提醒级）
    const missing = diagnostics.filter((d) => d.code === "missing-resource");
    expect(missing.map((d) => d.message)).toEqual([
      "资源路径不存在：Audio/missing.mp3",
    ]);
    expect(missing[0]?.pointer).toBe("/columns/0/commands/2/voice");
    expect(missing[0]?.severity).toBe("warning"); // 默认提醒即可，不拦保存

    // 未使用译文键：跨语言并集 - 故事原文（两族都命中：目录形态 + 单文件形态）
    const unused = diagnostics.filter((d) => d.code === "unused-translation");
    expect(
      unused.map((d) => d.message).filter((m) => m.includes("en 专属死键")),
    ).toHaveLength(1);
    expect(
      unused.map((d) => d.message).filter((m) => m.includes("孤儿键")),
    ).toHaveLength(1);
    // 消息自带「四个翻译面」口径说明
    expect(
      unused.every((d) => d.message.includes("say / menu / input / notify")),
    ).toBe(true);
    expect(unused.every((d) => d.severity === "warning")).toBe(true);

    // 缺译（正向）：原文 − overlay 并集 → 「缺语音」无任何译文
    const missingT = diagnostics.filter((d) => d.code === "missing-translation");
    expect(missingT).toHaveLength(1);
    expect(missingT[0]?.severity).toBe("warning");
    expect(missingT[0]?.message).toContain("缺语音");

    // 供给侧数据本身（组合根交付给界面的形态）
    expect([...supply.resourceFiles].sort()).toEqual([
      "Audio/ok.mp3",
      "Lang/en-US.json",
      "Lang/zh-CN/main.json",
      "Stories/start.json",
      "project.json",
    ]);
    expect([...supply.overlayKeys].sort()).toEqual([
      "en 专属死键",
      "你好",
      "孤儿键",
      "第二句",
    ]);
  });

  it("未打开工程时宿主不传第二参数 = 语义与「供给侧为空」一致（不误报）", async () => {
    const { story } = await openProject(journeyTree());
    const withoutSupply = analyzeStory(story);
    const emptySupply = analyzeStory(story, {
      resourceFiles: new Set<string>(),
      overlayKeys: new Set<string>(),
    });
    // 空集合 = 全报；不传 = 全跳过 —— 两者**必须**区分（前者会误报全部资源）
    expect(withoutSupply.filter((d) => d.code === "missing-resource")).toEqual([]);
    expect(
      emptySupply.filter((d) => d.code === "missing-resource"),
    ).toHaveLength(2);
  });

  it("无 Lang/ 目录：overlayKeys 空集（零 unused-translation），资源检查不受影响", async () => {
    const { story, supply } = await openProject(
      projectTree({
        commands: [{ op: "say", text: "你好", voice: "Audio/none.mp3" }],
      }),
    );
    expect([...supply.overlayKeys]).toEqual([]);
    expect(messagesOf(story, "unused-translation", supply)).toEqual([]);
    expect(messagesOf(story, "missing-resource", supply)).toEqual([
      "Audio/none.mp3",
    ]);
    // overlay 空 = 未启用 i18n → 缺译族整体跳过（原文直出是常态，不噪声）
    expect(messagesOf(story, "missing-translation", supply)).toEqual([]);
  });

  it("坏 overlay 宽容跳过：非法 JSON / 含非字符串值 → 整文件不参与（不崩溃、不误报）", async () => {
    const { story, supply } = await openProject(
      projectTree({
        commands: [{ op: "say", text: "你好" }],
        lang: {
          "zh-CN": {
            "main.json": "{ 这不是 JSON",
            "extra.json": JSON.stringify({ 你好: "你好" }),
            "bad-values.json": JSON.stringify({ 半坏键: 1, 另一个: "ok" }),
          },
        },
      }),
    );
    expect([...supply.overlayKeys]).toEqual(["你好"]);
    expect(messagesOf(story, "unused-translation", supply)).toEqual([]);
  });

  it("`.enc` 不做后缀特判：原样集合，明文名字直查口径", async () => {
    const { story, supply } = await openProject(
      projectTree({
        commands: [
          { op: "say", text: "甲", voice: "Audio/x.mp3" }, // 磁盘只有 x.mp3.enc → 运行期也解析不到 → 诚实报缺失
          { op: "say", text: "乙", voice: "Audio/sub.enc" }, // 真名叫 .enc 的明文资源 → 原样命中，不误报
          { op: "say", text: "丙", voice: "Audio/y.mp3" }, // 对照项：真缺
        ],
        resources: { Audio: { "x.mp3.enc": "cipher-bytes", "sub.enc": "plain" } },
      }),
    );
    expect([...supply.resourceFiles].sort()).toEqual([
      "Audio/sub.enc",
      "Audio/x.mp3.enc",
      "Stories/start.json",
      "project.json",
    ]);
    expect(messagesOf(story, "missing-resource", supply)).toEqual([
      "Audio/x.mp3",
      "Audio/y.mp3",
    ]);
  });

  it("加密 overlay（.json.enc）浏览器形态：密文解析失败 → 宽容跳过（少报不误报）", async () => {
    const { story, supply } = await openProject(
      projectTree({
        commands: [{ op: "say", text: "你好" }],
        lang: { "zh-CN": { "main.json.enc": "cipher-bytes" } },
      }),
    );
    expect([...supply.overlayKeys]).toEqual([]);
    expect(analyzeStory(story, supply)).toEqual([]);
  });

  it("加密 overlay（.json.enc）走同一供给：能解密的供给（Tauri 形态）正常参与对账", async () => {
    // 供给能力决定参与度：`text()` 返回明文（Rust 解密后的形态）→ 键正常入集；
    // 参与门槛只此一道——与明文 overlay 完全同口径，无任何 `.enc` 特判逻辑。
    const tree = projectTree({
      commands: [{ op: "say", text: "你好" }],
      lang: { "zh-CN": { "main.json.enc": "cipher-bytes" } },
    });
    const source = await createFileListFileSource(filesUnder("Resources", tree));
    const encPath = "Lang/zh-CN/main.json.enc";
    const decryptingSource = {
      ...source,
      text: async (path: string): Promise<string> =>
        path === encPath ? JSON.stringify({ 你好: "Hello" }) : source.text(path),
    };
    const supply = await loadDiagnosticSupply(decryptingSource);
    expect([...supply.overlayKeys]).toEqual(["你好"]);
  });

  it("混沌游走（种子化 40 轮）：报出的恰为「磁盘真没有的」与「故事真没引用的」", async () => {
    let seed = 20260927;
    const rand = (bound: number): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed % bound;
    };
    const pick = (pool: readonly string[], bound: number): string[] =>
      pool.filter(() => rand(3) > 0).slice(0, bound);

    const resourcePool = ["Audio/a.mp3", "Audio/b.mp3", "Images/i.png"];
    const keyPool = ["键甲", "键乙", "键丙", "键丁"];

    for (let round = 0; round < 40; round += 1) {
      const onDisk = pick(resourcePool, resourcePool.length);
      const referenced = pick(resourcePool, resourcePool.length).concat(
        rand(2) === 0 ? ["Audio/ghost.mp3"] : [],
      );
      const originals = pick(keyPool, keyPool.length);
      const overlay = pick(keyPool, keyPool.length).concat(
        rand(2) === 0 ? ["幽灵键"] : [],
      );

      const tree = projectTree({
        commands: referenced.map((voice, index) => ({
          op: "say",
          text: originals[index] ?? `原文${index}`,
          voice,
        })),
        resources: {
          Audio: Object.fromEntries(
            onDisk
              .filter((path) => path.startsWith("Audio/"))
              .map((path) => [path.slice("Audio/".length), "bytes"]),
          ),
          Images: Object.fromEntries(
            onDisk
              .filter((path) => path.startsWith("Images/"))
              .map((path) => [path.slice("Images/".length), "bytes"]),
          ),
        },
        lang:
          overlay.length === 0
            ? undefined
            : {
                "zh-CN": {
                  "main.json": JSON.stringify(
                    Object.fromEntries(overlay.map((key) => [key, key])),
                  ),
                },
              },
      });
      const { story, supply } = await openProject(tree);
      const diagnostics = analyzeStory(story, supply);

      // 不变量 1：缺失资源 = 引用集 - 磁盘集
      const expectedMissing = referenced
        .filter((path) => !onDisk.includes(path))
        .sort();
      expect(
        messagesOf(story, "missing-resource", supply),
        `round=${round}`,
      ).toEqual(expectedMissing);

      // 不变量 2：未使用译文 = overlay 键 - 故事原文
      const storyOriginals = new Set<string>(
        referenced.map((_, index) => originals[index] ?? `原文${index}`),
      );
      expect(
        messagesOf(story, "unused-translation", supply),
        `round=${round}`,
      ).toEqual(overlay.filter((key) => !storyOriginals.has(key)).sort());

      // 不变量：缺译 = 故事原文 - overlay 键（仅 overlay 非空 = 启用 i18n 时提醒）
      const expectedMissingT =
        overlay.length === 0
          ? []
          : [...storyOriginals].filter((key) => !overlay.includes(key)).sort();
      expect(
        messagesOf(story, "missing-translation", supply),
        `round=${round}`,
      ).toEqual(expectedMissingT);

      // 不变量：除三族外零诊断（结构合法）+ 指针可解析
      const others = diagnostics.filter(
        (d) =>
          d.code !== "missing-resource" &&
          d.code !== "unused-translation" &&
          d.code !== "missing-translation",
      );
      expect(others, `round=${round}`).toEqual([]);
      for (const diagnostic of diagnostics) {
        if (diagnostic.pointer === "") continue;
        expect(getAtPointer(story, diagnostic.pointer)).toBeDefined();
      }
    }
  });
});
