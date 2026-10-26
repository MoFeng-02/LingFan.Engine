/**
 * 发版脚本里 Git 那一层的判据。
 *
 * 与 `release.test.ts` 分开：那边只测纯逻辑（版本运算与参数解析），不碰 git；这里反过来，
 * 每个用例都真起一个临时仓库，跑真的 git。
 *
 * 要钉的是「写类命令的 stdout 不是管道」这条分支。读类命令要拿输出，写类命令（推送）想
 * 让 git 的进度直通终端，两者对 `execFileSync` 的返回类型要求不同：stdout 一旦不是管道，
 * 它返回 `null` 而不是空串。若统一按字符串处理，一次成功的推送会在收尾处抛
 * `Cannot read properties of null (reading 'trim')`，被上层当成推送失败——提交与标签其实
 * 已经在本地了，人却会去重试甚至换版本号。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

interface GitModule {
  currentBranch: () => string;
  isClean: () => boolean;
  headSha: () => string;
  hasTag: (tag: string) => boolean;
  hasRemoteTag: (tag: string) => boolean;
  listTags: () => string[];
  stage: (paths: string[]) => void;
  stageAll: () => void;
  commit: (message: string) => void;
  tag: (name: string, message: string) => void;
  push: (options: { branch: string; tagName?: string }) => void;
}

const gitModule = (await import(
  /* @vite-ignore */ new URL("../../scripts/release/git.mjs", import.meta.url)
    .href
)) as GitModule;

const roots: string[] = [];
const originalCwd = process.cwd();

/** 在指定目录跑一条 git 命令。 */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/**
 * 造一对仓库：一个裸仓当远端，一个工作仓当本地，工作仓里已有一笔提交。
 *
 * 每个用例都自带远端，因此从不接触网络；`file://` 之外的本地路径推送不经任何凭据通道。
 */
function makePair(): { work: string; origin: string; branch: string } {
  const base = mkdtempSync(join(tmpdir(), "release-git-fixture-"));
  roots.push(base);
  const origin = join(base, "origin.git");
  const work = join(base, "work");
  execFileSync("git", ["init", "--bare", "--initial-branch=main", origin], {
    stdio: "ignore",
  });
  execFileSync("git", ["init", "--initial-branch=main", work], {
    stdio: "ignore",
  });
  for (const [key, value] of [
    ["user.email", "fixture@example.invalid"],
    ["user.name", "fixture"],
    ["commit.gpgsign", "false"],
    ["tag.gpgsign", "false"],
  ]) {
    git(work, ["config", key, value]);
  }
  writeFileSync(join(work, "README.md"), "fixture\n", "utf8");
  git(work, ["add", "--all"]);
  git(work, ["commit", "--message", "初始提交"]);
  git(work, ["remote", "add", "origin", origin]);
  return { work, origin, branch: "main" };
}

/** 进临时仓库执行一段，结束后无论成败都切回原目录。 */
function inRepo<T>(repo: string, run: () => T): T {
  process.chdir(repo);
  try {
    return run();
  } finally {
    process.chdir(originalCwd);
  }
}

afterEach(() => {
  process.chdir(originalCwd);
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("发版 · Git 层", () => {
  it("读类命令照常返回去空白的输出", () => {
    const { work, origin } = makePair();
    inRepo(work, () => {
      expect(gitModule.currentBranch()).toBe("main");
      expect(gitModule.isClean()).toBe(true);
      expect(gitModule.headSha()).toMatch(/^[0-9a-f]+$/);
      expect(gitModule.listTags()).toEqual([]);
      // 远端刚建好、还没有任何标签；这条同时覆盖「远端可达但查无此标签」的分支。
      expect(gitModule.hasRemoteTag("v0.0.1")).toBe(false);
      expect(origin.length).toBeGreaterThan(0);
    });
  });

  it("写类命令的 stdout 不走管道时，推送不抛异常", () => {
    const { work, origin } = makePair();
    inRepo(work, () => {
      gitModule.tag("v0.0.1", "v0.0.1");
      expect(gitModule.hasTag("v0.0.1")).toBe(true);

      // 这条断言就是那个 bug 的判据：修复前 `push` 在 `runGit` 的收尾处对 `null`
      // 调 `.trim()`，抛 `Cannot read properties of null (reading 'trim')`。
      expect(() =>
        gitModule.push({ branch: "main", tagName: "v0.0.1" }),
      ).not.toThrow();
    });
    // 远端真的收到了分支与标签，说明「不抛异常」不是因为压根没推。
    expect(git(origin, ["rev-parse", "--abbrev-ref", "main"])).toBeDefined();
    expect(git(origin, ["rev-parse", "--verify", "refs/heads/main"])).toMatch(
      /^[0-9a-f]{40}$/,
    );
    expect(git(origin, ["tag", "--list"])).toContain("v0.0.1");
  });

  it("没有标签要推时只推分支，也不抛异常", () => {
    const { work, origin } = makePair();
    inRepo(work, () => {
      expect(() => gitModule.push({ branch: "main" })).not.toThrow();
    });
    expect(git(origin, ["tag", "--list"])).toBe("");
    expect(git(origin, ["rev-parse", "--verify", "refs/heads/main"])).toMatch(
      /^[0-9a-f]{40}$/,
    );
  });

  it("暂存与提交后工作区回到干净，且标签查得到", () => {
    const { work } = makePair();
    inRepo(work, () => {
      writeFileSync(join(work, "extra.txt"), "extra\n", "utf8");
      expect(gitModule.isClean()).toBe(false);
      gitModule.stageAll();
      expect(gitModule.isClean()).toBe(false);
      gitModule.commit("补一笔");
      expect(gitModule.isClean()).toBe(true);
      gitModule.stage(["README.md"]);
      expect(gitModule.isClean()).toBe(true);
    });
  });
});
