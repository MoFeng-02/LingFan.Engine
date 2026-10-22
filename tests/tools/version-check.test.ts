/**
 * 版本一致性判据测试。
 *
 * 判据是纯函数（喂清单与标签，看是否报出问题），因此这里构造样本而不去读真实仓库——
 * 真实仓库的版本会随发版变化，把它写进断言等于每次发版都改测试。
 *
 * 为什么值得单独钉住：版本错开不会让任何单包报错，只会在消费方装包时变成无解组合；
 * 标签与版本不一致更隐蔽——registry 上会出现标称与内容不符的版本，事后只能补发新号。
 */
import { describe, expect, it } from "vitest";

interface VersionCheckModule {
  VERSIONED_PACKAGES: string[];
  TAG_PREFIX: string;
  versionOfTag: (tag: string) => { version?: string; problem?: string };
  checkVersions: (input: {
    manifests: { label: string; manifest: Record<string, unknown> }[];
    tag?: string;
  }) => string[];
}

const versionCheck = (await import(
  /* @vite-ignore */ new URL("../../scripts/version-check.mjs", import.meta.url)
    .href
)) as VersionCheckModule;
const { VERSIONED_PACKAGES, TAG_PREFIX, versionOfTag, checkVersions } =
  versionCheck;

/**
 * 六个包加仓库根，全部同号：每个用例只破坏想测的那一处。
 *
 * 显式标注返回类型而不是让 TS 推断：推断会收紧成「必有 name」的联合类型，
 * 于是「把某一份改成空清单」这种用例在类型层面就不成立，而它恰恰是要测的场景。
 */
function sampleManifests(
  version = "0.1.2",
): { label: string; manifest: Record<string, unknown> }[] {
  return [
    { label: "仓库根", manifest: { version } },
    ...VERSIONED_PACKAGES.map((name) => ({
      label: name,
      manifest: { name, version },
    })),
  ];
}

describe("版本一致性判据", () => {
  it("全部同号且标签对齐时零失败", () => {
    expect(
      checkVersions({ manifests: sampleManifests(), tag: "v0.1.2" }),
    ).toEqual([]);
  });

  it("本地自检不传标签时只查包之间是否齐", () => {
    expect(checkVersions({ manifests: sampleManifests() })).toEqual([]);
  });

  it("某个包版本掉队会被拦下，并指出是哪一份", () => {
    const manifests = sampleManifests();
    manifests[3] = {
      label: "@lingfan-engine/ui",
      manifest: { version: "0.1.1" },
    };
    const failures = checkVersions({ manifests });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("@lingfan-engine/ui");
    expect(failures[0]).toContain("0.1.1");
  });

  it("仓库根缺版本时单独报错，而不是连带每个包都报不一致", () => {
    const manifests = sampleManifests();
    manifests[0] = { label: "仓库根", manifest: {} };
    const failures = checkVersions({ manifests });
    expect(failures.some((item) => item.includes("仓库根"))).toBe(true);
  });

  it("非语义化版本会被拦下——registry 会拒收这类版本", () => {
    // 样本把版本灌给全部清单，因此每条都要报：判据不因「根已报过」就放过包里的同一问题。
    // 七份清单各报一条，外加根版本自身的一条——共八条。
    for (const bad of ["v0.1.2", "0.1", "0.1.2.3"]) {
      const failures = checkVersions({ manifests: sampleManifests(bad) });
      expect(failures).toHaveLength(8);
      expect(failures.every((item) => item.includes("语义化版本"))).toBe(true);
    }
  });

  it("预发布版本是合法形态，不该被误拦", () => {
    expect(checkVersions({ manifests: sampleManifests("0.1.2-rc.1") })).toEqual(
      [],
    );
  });

  it("标签与仓库版本不一致会被拦下——这是标称与内容不符的源头", () => {
    const failures = checkVersions({
      manifests: sampleManifests(),
      tag: "v0.1.1",
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("v0.1.1");
    expect(failures[0]).toContain("0.1.2");
  });

  it("标签缺前缀时报错而不是静默接受", () => {
    const failures = checkVersions({
      manifests: sampleManifests(),
      tag: "release-0.1.2",
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("前缀");
  });

  it("标签解析只做前缀剥离，不做宽松猜测", () => {
    expect(TAG_PREFIX).toBe("v");
    expect(versionOfTag("v0.1.2")).toEqual({
      version: "0.1.2",
      problem: undefined,
    });
    expect(versionOfTag("0.1.2").problem).toBeDefined();
  });

  it("发布清单与发布自检同口径：六个包", () => {
    expect(VERSIONED_PACKAGES).toEqual([
      "@lingfan-engine/core",
      "@lingfan-engine/adapters",
      "@lingfan-engine/ui",
      "@lingfan-engine/shell",
      "@lingfan-engine/editor",
      "@lingfan-engine/stories-build",
    ]);
  });
});
