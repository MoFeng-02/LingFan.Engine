/**
 * 版本运算与发版参数解析的判据。
 *
 * 这两块是发版脚本里唯一「纯逻辑」的部分：不碰网络、不碰 git、不碰文件系统。
 * 其余步骤（写清单、跑门禁、提交、推远端）的失败都能从输出看出来，而版本算错
 * 只会安静地发一个错号出去——registry 上没人能改，只能补发新版本。
 *
 * 因此这里的重点是几处容易写错的分支：预发布怎么递增、预发布怎么排序、
 * dist-tag 从哪来、构建元数据为什么必须拦下。
 */
import { describe, expect, it } from "vitest";

interface VersionModule {
  LATEST_TAG: string;
  parseVersion: (text: unknown) => Record<string, unknown> | undefined;
  formatVersion: (
    parsed: Record<string, number | string | undefined>,
  ) => string;
  bumpVersion: (current: string, level: string) => string;
  compareVersions: (left: string, right: string) => number;
  distTagOf: (version: string) => string;
  assertReleasable: (version: string) => string | undefined;
}

interface MainModule {
  runRelease: (
    argv: string[],
    options?: { log?: (line: string) => void },
  ) => Promise<number>;
}

const versionModule = (await import(
  /* @vite-ignore */ new URL(
    "../../scripts/release/version.mjs",
    import.meta.url,
  ).href
)) as VersionModule;
const {
  LATEST_TAG,
  parseVersion,
  bumpVersion,
  compareVersions,
  distTagOf,
  assertReleasable,
} = versionModule;

const mainModule = (await import(
  /* @vite-ignore */ new URL("../../scripts/release/main.mjs", import.meta.url)
    .href
)) as MainModule;
const { runRelease } = mainModule;

describe("发版 · 版本解析", () => {
  it("接受主.次.修订与带后缀的预发布", () => {
    expect(parseVersion("1.2.3")).toMatchObject({
      major: 1,
      minor: 2,
      patch: 3,
    });
    expect(parseVersion("0.2.0-rc.1")?.prerelease).toBe("rc.1");
    expect(parseVersion("0.2.0-alpha.1")?.prerelease).toBe("alpha.1");
    expect(parseVersion("0.2.0-beta")?.prerelease).toBe("beta");
  });

  it("拒绝 v 前缀、范围符号与四段点分", () => {
    expect(parseVersion("v1.2.3")).toBeUndefined();
    expect(parseVersion("^1.2.3")).toBeUndefined();
    expect(parseVersion("1.2.3.rc.1")).toBeUndefined();
    expect(parseVersion("1.2")).toBeUndefined();
    expect(parseVersion(undefined)).toBeUndefined();
  });

  it("构建元数据认得出，但发布前必须被拦下", () => {
    expect(parseVersion("1.2.3+build.5")?.build).toBe("build.5");
    expect(assertReleasable("1.2.3+build.5")).toContain("构建元数据");
    expect(assertReleasable("1.2.3")).toBeUndefined();
    expect(assertReleasable("1.2.3-rc.1")).toBeUndefined();
  });
});

describe("发版 · 版本递增", () => {
  it("三个档位各自归零更低位的数", () => {
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });

  it("当前是预发布时，任何档位都只清后缀、不再涨一档", () => {
    expect(bumpVersion("0.2.0-rc.1", "patch")).toBe("0.2.0");
    expect(bumpVersion("0.2.0-rc.1", "minor")).toBe("0.2.0");
    expect(bumpVersion("0.2.0-rc.1", "major")).toBe("0.2.0");
  });

  it("未知档位直接报错，而不是默默按补丁处理", () => {
    expect(() => bumpVersion("1.2.3", "premajor")).toThrow(/未知的递增档位/);
  });
});

describe("发版 · 版本比较", () => {
  it("预发布小于对应的正式版", () => {
    expect(compareVersions("0.2.0-rc.1", "0.2.0")).toBe(-1);
    expect(compareVersions("0.2.0", "0.2.0-rc.1")).toBe(1);
  });

  it("预发布逐段比较：数字段按数值、字母段按字典序、数字小于字母", () => {
    expect(compareVersions("0.2.0-rc.2", "0.2.0-rc.10")).toBe(-1);
    expect(compareVersions("0.2.0-alpha.1", "0.2.0-beta.1")).toBe(-1);
    expect(compareVersions("0.2.0-1", "0.2.0-alpha")).toBe(-1);
    expect(compareVersions("0.2.0-rc.1", "0.2.0-rc.1.1")).toBe(-1);
  });

  it("主次修订优先于后缀", () => {
    expect(compareVersions("0.1.9", "0.2.0-rc.1")).toBe(-1);
  });
});

describe("发版 · dist-tag", () => {
  it("正式版永远发到 latest", () => {
    expect(distTagOf("1.2.3")).toBe(LATEST_TAG);
    expect(distTagOf("1.2.3")).toBe("latest");
  });

  it("预发布用后缀第一段，让 rc 与 alpha 在 registry 上互不覆盖", () => {
    expect(distTagOf("0.2.0-rc.1")).toBe("rc");
    expect(distTagOf("0.2.0-alpha.1")).toBe("alpha");
    expect(distTagOf("1.0.0-beta")).toBe("beta");
    expect(distTagOf("1.0.0-next-2024")).toBe("next-2024");
  });

  it("后缀以数字开头时退回一个固定名字，不产出非法 dist-tag", () => {
    expect(distTagOf("1.0.0-1.2")).toBe("prerelease");
  });
});

describe("发版 · 参数解析", () => {
  const silent = { log: () => {} };

  it("既没给 --bump 也没给 --version 时拒绝执行", async () => {
    expect(await runRelease([], silent)).toBe(1);
  });

  it("同时给 --bump 与 --version 时拒绝执行", async () => {
    expect(
      await runRelease(["--bump", "patch", "--version", "2.0.0"], silent),
    ).toBe(1);
  });

  it("--bump 只接受三个档位", async () => {
    expect(await runRelease(["--bump", "premajor"], silent)).toBe(1);
  });

  it("无法识别的参数不会被忽略", async () => {
    expect(await runRelease(["--bump", "patch", "--force"], silent)).toBe(1);
  });

  it("两种写法都认：空格分隔与等号", async () => {
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);
    expect(await runRelease(["--bump=patch", "--dry-run"], { log })).toBe(0);
    expect(
      await runRelease(["--version=0.2.0-rc.1", "--dry-run"], { log }),
    ).toBe(0);
    expect(lines.some((line) => line.includes("0.2.0-rc.1"))).toBe(true);
  });
});
