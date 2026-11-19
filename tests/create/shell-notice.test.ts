/**
 * 桌面壳生成完成提示的安全口径（诚实声明）。
 *
 * 为什么测这个：模板桌面壳存档是明文参考实现，生成器若在完成提示里把它说成
 * 「安全 / 加密」，使用者就会带着错误预期交付。这里锁定两条行为——tauri 壳必须
 * 打印降格声明，browser 壳不打印（它根本没有原生存档层，声明无从谈起）。
 *
 * 手法：版本查询与写盘都是副作用，替身掉之后只留「完成提示怎么拼」这一段真逻辑，
 * 捕获 stdout 逐字断言。声明文案取自集中文案表，避免测试与实现各拼一份漂移。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCreateTexts } from "../../packages/create/src/shared/texts.ts";
import type { GenerateResult } from "../../packages/create/src/generate/project.ts";
import {
  runStage,
  type StageOptions,
} from "../../packages/create/src/cli/stage.ts";
import { generateProject } from "../../packages/create/src/generate/index.ts";

vi.mock("../../packages/create/src/registry/index.ts", () => ({
  resolveVersions: vi.fn(async () => new Map()),
  checkEngineCompatibility: vi.fn(() => undefined),
}));
vi.mock("../../packages/create/src/generate/index.ts", () => ({
  collectDependencyNames: vi.fn(() => []),
  layerBases: vi.fn(() => []),
  generateProject: vi.fn(),
}));
vi.mock("../../packages/create/src/cli/install.ts", () => ({
  installProject: vi.fn(async () => true),
  renderNextSteps: vi.fn(() => "cd demo\ninstall\ndev"),
}));

function resultOf(shell: string): GenerateResult {
  return {
    projectDir: "E:/tmp/demo",
    fileCount: 42,
    framework: "none",
    shell,
    sources: "ts",
  };
}

function optionsOf(shell: string): StageOptions {
  return {
    meta: {
      version: "1.0.0",
      minEngineVersion: "0.1.0",
    } as StageOptions["meta"],
    templateRoot: "E:/tmp/template",
    dir: undefined,
    projectName: "demo",
    description: "",
    framework: "none",
    shell,
    sources: "ts",
    existing: "ignore",
    install: false,
  };
}

let stdout: string[] = [];
beforeEach(() => {
  stdout = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("桌面壳完成提示 · 安全口径诚实声明（create-notice-honest）", () => {
  it("tauri 壳：完成提示含明文降格声明（明文参考实现 + 自带 Rust 加密层 + 全栈指引）", async () => {
    vi.mocked(generateProject).mockReturnValue(resultOf("tauri"));
    const code = await runStage(optionsOf("tauri"));
    expect(code).toBe(0);
    const text = stdout.join("");
    expect(text).toContain(defaultCreateTexts.shellTauriNotice);
    expect(text).toContain("明文参考实现");
    expect(text).toContain("交付安全需自带 Rust 加密层");
    expect(text).toContain("K1–K8");
    expect(text).toContain("playground");
  });

  it("tauri 壳：声明不得宣称存档已加密 / 已安全（诚实检查）", async () => {
    vi.mocked(generateProject).mockReturnValue(resultOf("tauri"));
    await runStage(optionsOf("tauri"));
    const notice = defaultCreateTexts.shellTauriNotice;
    expect(notice).not.toMatch(/存档已加密|存档是安全的|默认加密/);
    expect(notice).toContain("不加密");
  });

  it("browser 壳：不打印桌面壳降格声明（无原生存档层）", async () => {
    vi.mocked(generateProject).mockReturnValue(resultOf("browser"));
    const code = await runStage(optionsOf("browser"));
    expect(code).toBe(0);
    const text = stdout.join("");
    expect(text).toContain(defaultCreateTexts.doneTitle);
    expect(text).not.toContain(defaultCreateTexts.shellTauriNotice);
    expect(text).not.toContain("明文参考实现");
  });

  it("miniprogram 壳：同样不打印桌面壳降格声明", async () => {
    vi.mocked(generateProject).mockReturnValue(resultOf("miniprogram"));
    await runStage(optionsOf("miniprogram"));
    expect(stdout.join("")).not.toContain(defaultCreateTexts.shellTauriNotice);
  });

  it("声明文案集中在文案表（单一事实源，CLI 不另拼一份）", () => {
    expect(defaultCreateTexts.shellTauriNotice.length).toBeGreaterThan(0);
    expect(defaultCreateTexts.shellTauriNotice).toContain("Rust");
  });
});
