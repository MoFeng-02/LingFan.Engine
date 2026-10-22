import { describe, expect, it } from "vitest";

/**
 * 发布脚本的判据。
 *
 * 只测「不产生外部副作用」的部分：命名、清单读取、以及发布清单与打包脚本同源。
 * 真正上传与 `npm view` 探测依赖网络，放在流水线里由脚本自身的演练开关验证。
 */
interface PublishTarballsModule {
  tarballName: (name: string, version: string) => string;
  manifestOf: (name: string) => { name?: string; version?: string };
}

const publishTarballs = (await import(
  /* @vite-ignore */ new URL(
    "../../scripts/publish-tarballs.mjs",
    import.meta.url,
  ).href
)) as PublishTarballsModule;
const { tarballName, manifestOf } = publishTarballs;

const publishCheck = (await import(
  /* @vite-ignore */ new URL("../../scripts/publish-check.mjs", import.meta.url)
    .href
)) as { PUBLISHED_PACKAGES: string[] };
const { PUBLISHED_PACKAGES } = publishCheck;

describe("发布脚本 · tarball 命名", () => {
  it("按包名去 scope 加版本号命名，与 pnpm pack 的产物一致", () => {
    expect(tarballName("@lingfan-engine/core", "0.1.2")).toBe(
      "lingfan-engine-core-0.1.2.tgz",
    );
    expect(tarballName("@lingfan-engine/stories-build", "0.1.2")).toBe(
      "lingfan-engine-stories-build-0.1.2.tgz",
    );
  });

  it("预发布版本原样保留后缀，不被截断", () => {
    expect(tarballName("@lingfan-engine/ui", "0.2.0-rc.1")).toBe(
      "lingfan-engine-ui-0.2.0-rc.1.tgz",
    );
  });
});

describe("发布脚本 · 清单读取", () => {
  it("读到的清单就是包自己声明的名字，不需要再拼仓库根", () => {
    for (const name of PUBLISHED_PACKAGES) {
      const manifest = manifestOf(name);
      expect(manifest.name).toBe(name);
      expect(typeof manifest.version).toBe("string");
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  it("六个包都读得到，发布面与打包自检同源", () => {
    expect(PUBLISHED_PACKAGES).toHaveLength(6);
    const versions = PUBLISHED_PACKAGES.map((name) => manifestOf(name).version);
    expect(new Set(versions).size).toBe(1);
  });
});
