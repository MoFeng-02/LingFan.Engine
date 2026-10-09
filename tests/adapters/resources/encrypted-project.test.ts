/**
 * 加密工程形态识别与无壳形态拒绝
 *
 * 验收集点：
 * 1. **判定规则**（存在任一 `.enc` 即加密工程；故事/资源/overlay 三类都算；明文根零误判）；
 * 2. **前置拒绝**（在读取任何文件之前抛——用替身 source 的 `text()` 调用计数验证）；
 * 3. **提示可操作**（说清是什么 / 为什么读不了 / 现在怎么办），且**不装作能读**；
 * 4. **唯一判定点**（源级断言：故事循环里不再有第二份 `.enc` 判定；资源侧仍不做后缀特判）。
 */
import { describe, expect, it } from "vitest";
import {
  createSourceProjectFilesPort,
  detectEncryptedProject,
  encryptedProjectMessage,
  type ProjectFileSource,
} from "@lingfan/adapters";
import encryptedProjectSource from "../../../packages/adapters/src/resources/encryptedProject.ts?raw";

/** 目录取径供给的源码全集（键排序只为失败信息稳定，结果不影响判定） */
const DIRECTORY_SOURCE_MODULES = import.meta.glob(
  "../../../packages/adapters/src/resources/directory-source/**/*.ts",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

const directorySourceSource = Object.keys(DIRECTORY_SOURCE_MODULES)
  .sort()
  .map((path) => DIRECTORY_SOURCE_MODULES[path] ?? "")
  .join("\n");

/** 替身供给：只给路径与文本，**记录 text() 调用**（供「前置拒绝」验证） */
function fakeSource(
  name: string,
  files: Record<string, string>,
): ProjectFileSource & { reads: string[] } {
  const reads: string[] = [];
  return {
    name,
    reads,
    async paths(): Promise<readonly string[]> {
      return Object.keys(files).sort();
    },
    async text(path: string): Promise<string> {
      reads.push(path);
      const value = files[path];
      if (value === undefined) throw new Error(`缺少 ${path}`);
      return value;
    },
    async file(path: string): Promise<File> {
      throw new Error(`替身不提供文件对象：${path}`);
    },
  };
}

const MANIFEST = JSON.stringify({
  formatVersion: 1,
  id: "demo",
  entry: "start",
});

describe("判定规则：**故事密文**才拒绝（资源/overlay 密文是既有有意设计，不拒）", () => {
  it("故事密文（lfenpack 典型形态）→ 命中，证据含故事密文", () => {
    const finding = detectEncryptedProject([
      "project.json",
      "Stories/start.json.enc",
      "Audio/bgm.ogg.enc",
    ]);
    expect(finding.encrypted).toBe(true);
    expect(finding.encryptedStories).toEqual(["Stories/start.json.enc"]);
    expect(finding.count).toBe(2); // 证据统计含全部密文（资源也计入）
  });

  it("仅资源密文（故事明文）→ **不拒绝**：诚实报缺失，不制造分叉", () => {
    // 既有有意设计：磁盘上没有明文 Audio/x.mp3 ⇒ missing-resource 诚实报缺失；
    // 剥后缀 / 读头会制造「编辑器说在、运行期说缺」的分叉。
    const finding = detectEncryptedProject([
      "project.json",
      "Stories/start.json",
      "Images/lingfan.png.enc",
    ]);
    expect(finding.encrypted).toBe(false);
    expect(finding.encryptedStories).toEqual([]);
    expect(finding.count).toBe(1); // 仍是信息性证据
  });

  it("仅 overlay 密文（故事明文）→ **不拒绝**：宽容跳过，少报不误报", () => {
    const finding = detectEncryptedProject([
      "project.json",
      "Stories/start.json",
      "Lang/ja/main.json.enc",
    ]);
    expect(finding.encrypted).toBe(false);
    expect(finding.count).toBe(1);
  });

  it("明文工程 → 零命中（不误判）", () => {
    const finding = detectEncryptedProject([
      "project.json",
      "Stories/start.json",
      "Audio/bgm.ogg",
      "Lang/ja/main.json",
      "Notes/readme.txt",
    ]);
    expect(finding).toEqual({
      encrypted: false,
      encryptedStories: [],
      evidence: [],
      count: 0,
    });
  });

  it(".enc 只作**后缀**判定（名字里含 enc 的明文文件不误判）", () => {
    const finding = detectEncryptedProject([
      "Stories/encoder-demo.json",
      "Audio/enc.txt",
    ]);
    expect(finding.encrypted).toBe(false);
  });

  it("证据稳定排序（提示与将来的桌面分叉都依赖确定性）", () => {
    const finding = detectEncryptedProject([
      "Stories/z.json.enc",
      "Audio/a.ogg.enc",
      "Stories/a.json.enc",
    ]);
    expect(finding.evidence).toEqual([
      "Audio/a.ogg.enc",
      "Stories/a.json.enc",
      "Stories/z.json.enc",
    ]);
    expect(finding.encryptedStories).toEqual([
      "Stories/a.json.enc",
      "Stories/z.json.enc",
    ]);
  });
});

describe("拒绝文案：可操作（是什么 / 为什么 / 怎么办），不装作能读", () => {
  it("含工程名、密文计数与样例、以及「改选明文工程」的出口", () => {
    const finding = detectEncryptedProject([
      "Stories/start.json.enc",
      "Audio/bgm.ogg.enc",
      "Images/lingfan.png.enc",
      "Lang/ja/main.json.enc",
    ]);
    const message = encryptedProjectMessage("Resources", finding);
    expect(message).toContain("Resources"); // 哪个根
    expect(message).toContain("加密工程"); // 是什么
    expect(message).toContain("故事为密文"); // 拒绝依据
    expect(message).toContain(finding.encryptedStories[0]!); // 样例（证据升序首条）
    expect(message).toContain("另有 3 个密文文件"); // 资源/译文密文如实附带
    expect(message).toContain("没有解密密钥"); // 为什么
    expect(message).toContain("明文工程"); // 怎么办（现在可做的那条）
    expect(message).toContain("桌面壳"); // 另一条路（尚不存在，如实说明）
  });

  it("无附带密文时不出现「另有」尾巴（文案随证据自适应）", () => {
    const message = encryptedProjectMessage(
      "R",
      detectEncryptedProject(["Stories/a.json.enc"]),
    );
    expect(message).not.toContain("另有");
  });

  it("口径区分：故事密文是拒绝依据；仅资源密文不拒绝（各有正当语义）", () => {
    expect(
      detectEncryptedProject(["Stories/a.json.enc"]).encrypted,
    ).toBe(true);
    expect(
      detectEncryptedProject(["Images/a.png.enc"]).encrypted,
    ).toBe(false);
  });

  it("样例最多列三条，其余以「等」收尾（长列表不刷屏）", () => {
    const finding = detectEncryptedProject([
      "Stories/a.json.enc",
      "Stories/b.json.enc",
      "Stories/c.json.enc",
      "Stories/d.json.enc",
      "Stories/e.json.enc",
    ]);
    const message = encryptedProjectMessage("R", finding);
    expect(message).toContain("Stories/a.json.enc");
    expect(message).toContain("等。");
    expect(message).not.toContain("Stories/e.json.enc");
  });
});

describe("前置拒绝：读任何文件之前就抛（不白读一批、不报成「某个文件的问题」）", () => {
  it("加密根打开 → 抛统一文案，且 text() 零调用", async () => {
    const source = fakeSource("Resources", {
      "project.json": MANIFEST,
      "Stories/start.json.enc": "CIPHERTEXT",
      "Audio/bgm.ogg.enc": "CIPHERTEXT",
    });
    const port = createSourceProjectFilesPort(source);
    await expect(port.manifest()).rejects.toThrow(/加密工程/);
    expect(source.reads).toEqual([]); // ← 前置：一个文件都没读
  });

  it("错误信息可操作（含明文工程出口），且不是「某个文件」的口径", async () => {
    const source = fakeSource("MyGame", {
      "project.json": MANIFEST,
      "Stories/a.json.enc": "X",
    });
    const port = createSourceProjectFilesPort(source);
    await expect(port.manifest()).rejects.toThrow(/MyGame[\s\S]*明文工程/);
    await expect(port.manifest()).rejects.not.toThrow(/故事 .* 为加密形态/);
  });

  it("资源密文/overlay 密文不触发拒绝（回归：既有「诚实报缺失 / 宽容跳过」设计不受影响）", async () => {
    const source = fakeSource("Resources", {
      "project.json": MANIFEST,
      "Stories/start.json": JSON.stringify({
        id: "start",
        kind: "flow",
        commands: [{ op: "say", text: "甲" }],
      }),
      "Audio/x.mp3.enc": "cipher-bytes",
      "Lang/zh-CN/main.json.enc": "cipher-bytes",
    });
    const port = createSourceProjectFilesPort(source);
    await expect(port.manifest()).resolves.toMatchObject({ id: "demo" });
    await expect(port.stories()).resolves.toBeInstanceOf(Map);
  });

  it("明文根照常打开（回归：判定不误伤正常工程）", async () => {
    const source = fakeSource("Resources", {
      "project.json": MANIFEST,
      "Stories/start.json": JSON.stringify({
        id: "start",
        kind: "flow",
        commands: [{ op: "say", text: "甲" }],
      }),
    });
    const port = createSourceProjectFilesPort(source);
    await expect(port.manifest()).resolves.toMatchObject({ id: "demo" });
    await expect(port.stories()).resolves.toBeInstanceOf(Map);
    // 装载顺序 = **先 Stories 后清单**（缺清单时要先读到故事才能合成清单）
    expect(source.reads).toEqual(["Stories/start.json", "project.json"]);
  });

  it("清单缺失的报错仍在加密判定之后（明文根 + 无清单 + 无可解析列 → 降级失败报错，不是加密报错）", async () => {
    const source = fakeSource("Resources", { "Stories/a.json": "{}" });
    const port = createSourceProjectFilesPort(source);
    // 缺清单 ⇒ 尝试合成；零可解析列 ⇒ fail-closed（报错仍**不是**加密报错 —— 本测意图不变）
    await expect(port.manifest()).rejects.toThrow(/没有可打开的内容/);
  });
});

describe("唯一判定点：不得出现第二份「.enc 形态」判定", () => {
  it("供给层的加密判定只调用 encryptedProject 的判定函数", () => {
    expect(directorySourceSource).toContain("detectEncryptedProject(");
    expect(directorySourceSource).toContain("encryptedProjectMessage(");
    // 不得在故事循环里逐路径 endsWith(".enc") 抛错 —— 必须已移除
    expect(directorySourceSource).not.toContain('path.endsWith(".enc")');
  });

  it("判定规则本身只写在 encryptedProject 模块里（后缀常量单点）", () => {
    expect(encryptedProjectSource).toContain('const ENC_SUFFIX = ".enc"');
    // 供给层唯一允许的 `.enc` 字面量 = overlay 候选**选择器**（`.json.enc`：
    // 有解密能力的供给——如 Tauri 形态 text() 经 Rust 解密——照常入集参与对账）；
    // 「是不是加密工程」的判定不得在此再写一份。
    expect(directorySourceSource).toContain('path.endsWith(".json.enc")');
    expect((directorySourceSource.match(/\.enc"/g) ?? [])).toHaveLength(1);
    expect(directorySourceSource).not.toMatch(/endsWith\(\s*"\.enc"\s*\)/);
  });

  it("资源侧仍**不做** .enc 后缀特判（不制造「编辑器说在、运行期说缺」分叉）", () => {
    // 能打开的工程必然是明文（加密根已前置拒绝）⇒ 运行期逻辑路径直查。
    // 若有人给资源侧加剥后缀/读头，这里会红——那正是要拦住的漂移。
    expect(directorySourceSource).not.toContain("stripEncSuffix");
    expect(directorySourceSource).not.toContain("readMagic");
  });
});