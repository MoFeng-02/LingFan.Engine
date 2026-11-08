/**
 * 非交互终端的判据。
 *
 * 生成器被管道、CI 或重定向的 stdin 调用时没有任何人可以按回车。此处必须明确
 * 失败并说清「缺什么、怎么补」，而不是把问题打到 stderr 上等一个永远不来的输入——
 * 后者在 CI 里表现为任务卡到超时，错误信息是「超时」而不是「缺参数」。
 *
 * `--yes` 是另一条路：它承诺全部取缺省，因此同样在没有终端的环境里必须跑通。
 * 这里真的生成一份工程：只有落到磁盘才证明「没问问题、也没卡住」。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCreateCli } from "../../../packages/create/src/cli/cli.ts";
import { defaultCreateTexts } from "../../../packages/create/src/shared/texts.ts";

/** 版本查询指到不可达地址：离线路径要秒失败，而不是撞测试超时 */
const OFFLINE_REGISTRY = "http://127.0.0.1:9";

let workDir = "";

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "create-non-tty-"));
  vi.stubEnv("LINGFAN_CREATE_REGISTRY", OFFLINE_REGISTRY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(workDir, { recursive: true, force: true });
});

/** 断言当前进程确实「没有终端」，否则这组用例的前提不成立 */
function expectNonInteractive(): void {
  expect(process.stdin.isTTY).not.toBe(true);
}

describe("非交互终端", () => {
  it("还有待问项时失败，并说清缺什么、可用哪些参数", async () => {
    expectNonInteractive();
    const stderr: string[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: unknown) => {
        stderr.push(String(chunk));
        return true;
      });
    let code: number;
    try {
      code = await runCreateCli(["--dir", workDir]);
    } finally {
      spy.mockRestore();
    }
    const output = stderr.join("");
    expect(code).toBe(1);
    expect(output).toContain(defaultCreateTexts.nonInteractive);
    expect(output).toContain("--description");
    expect(output).toContain("--framework");
    expect(output).toContain("--shell");
    expect(output).toContain("--sources");
    expect(existsSync(join(workDir, "lingfan-story"))).toBe(false);
  });

  it("已经用参数指定了工程名与形态时，只剩描述没给也算待问项", async () => {
    expectNonInteractive();
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    let code: number;
    try {
      code = await runCreateCli([
        "my-story",
        "--framework",
        "none",
        "--shell",
        "browser",
        "--sources",
        "ts",
        "--dir",
        workDir,
      ]);
    } finally {
      spy.mockRestore();
    }
    expect(code).toBe(1);
  });

  it("`--yes` 全取缺省并真的生成，不问任何问题", async () => {
    expectNonInteractive();
    const stdout: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        stdout.push(String(chunk));
        return true;
      });
    let code: number;
    try {
      code = await runCreateCli(["--yes", "--dir", workDir]);
    } finally {
      spy.mockRestore();
    }
    const projectDir = join(workDir, "lingfan-story");
    expect(code).toBe(0);
    expect(existsSync(join(projectDir, "package.json"))).toBe(true);
    expect(stdout.join("")).toContain("lingfan-story");
    const manifest = JSON.parse(
      readFileSync(join(projectDir, "package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest.description).toBeUndefined();
  });

  it("参数齐全时非交互终端照常生成", async () => {
    expectNonInteractive();
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    let code: number;
    try {
      code = await runCreateCli([
        "my-story",
        "--description",
        "一段描述",
        "--framework",
        "none",
        "--shell",
        "browser",
        "--sources",
        "ts",
        "--dir",
        workDir,
      ]);
    } finally {
      spy.mockRestore();
    }
    expect(code).toBe(0);
    const manifest = JSON.parse(
      readFileSync(join(workDir, "my-story", "package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest.description).toBe("一段描述");
  });
});
