/**
 * 发布前自检的判据测试。
 *
 * 判据本身是纯函数（喂一份元数据与文件清单，看是否报出问题），因此这里直接构造样本，
 * 不去跑真实的打包——打包耗时且依赖工作区状态，属于 `pnpm publish:check` 的职责。
 *
 * 为什么要测判据而不只测脚本能跑：这些判据拦的是「发布成功、消费方装不上」的缺陷，
 * 一旦判据本身写错，事故不会在本地暴露，只会在装包时暴露。判据必须自己先被钉住。
 */
import { describe, expect, it } from "vitest";

/** 判据脚本是运行时导入的 .mjs，没有类型声明，这里按它的契约补一份 */
interface PackageSample {
  name: string;
  manifest: Record<string, unknown>;
  entries: string[];
  repoVersion: string;
}
interface PublishCheckModule {
  PUBLISHED_PACKAGES: string[];
  checkPackage: (sample: PackageSample) => string[];
  checkCrossPackage: (input: {
    manifests: Record<string, Record<string, unknown>>;
  }) => string[];
}

const publishCheck = (await import(
  /* @vite-ignore */ new URL("../../scripts/publish-check.mjs", import.meta.url)
    .href
)) as PublishCheckModule;
const { PUBLISHED_PACKAGES, checkPackage, checkCrossPackage } = publishCheck;

/** 一份全部合格的样本：每个用例只破坏想测的那一处 */
function healthyPackage(
  overrides: Record<string, unknown> = {},
): PackageSample {
  const manifest = {
    name: "@lingfan-engine/core",
    version: "0.1.1",
    description: "叙事引擎核心",
    license: "Apache-2.0",
    repository: { type: "git", url: "git+https://example.invalid/repo.git" },
    homepage: "https://example.invalid",
    bugs: "https://example.invalid/issues",
    exports: { ".": "./src/index.ts" },
    files: ["src"],
    engines: { node: ">=22.12.0" },
    publishConfig: { access: "public" },
    dependencies: {},
    ...overrides,
  };
  const entries = [
    "package/package.json",
    "package/LICENSE",
    "package/src/index.ts",
  ];
  return {
    name: manifest.name,
    manifest,
    entries,
    repoVersion: manifest.version,
  };
}

describe("发布包元数据判据", () => {
  it("全部合格时零失败", () => {
    expect(PUBLISHED_PACKAGES).toEqual([
      "@lingfan-engine/core",
      "@lingfan-engine/adapters",
      "@lingfan-engine/ui",
      "@lingfan-engine/shell",
      "@lingfan-engine/editor",
      "@lingfan-engine/stories-build",
    ]);
    expect(checkPackage(healthyPackage())).toEqual([]);
  });

  it("工作区协议残留会被拦下——这是消费方安装失败的直接原因", () => {
    const failures = checkPackage(
      healthyPackage({
        dependencies: { "@lingfan-engine/core": "workspace:^" },
      }),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("workspace:^");
  });

  it("peerDependencies 里的工作区协议同样算残留", () => {
    const failures = checkPackage(
      healthyPackage({
        peerDependencies: { "@lingfan-engine/ui": "workspace:*" },
      }),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("workspace:*");
  });

  it("缺少许可副本会被拦下——分发时就没有许可声明", () => {
    const sample = healthyPackage();
    const failures = checkPackage({
      ...sample,
      entries: sample.entries.filter((entry) => entry !== "package/LICENSE"),
    });
    expect(failures.some((item) => item.includes("LICENSE"))).toBe(true);
  });

  it("包内含测试文件会被拦下", () => {
    const sample = healthyPackage();
    const failures = checkPackage({
      ...sample,
      entries: [...sample.entries, "package/src/runtime/engine.test.ts"],
    });
    expect(failures.some((item) => item.includes("engine.test.ts"))).toBe(true);
  });

  it("标记为 private 的包会被拦下", () => {
    const failures = checkPackage(healthyPackage({ private: true }));
    expect(failures.some((item) => item.includes("private"))).toBe(true);
  });

  it("缺少 public 访问声明会被拦下", () => {
    const failures = checkPackage(healthyPackage({ publishConfig: {} }));
    expect(failures.some((item) => item.includes("publishConfig"))).toBe(true);
  });

  it("版本与仓库声明不一致会被拦下", () => {
    const failures = checkPackage({
      ...healthyPackage(),
      repoVersion: "0.2.0",
    });
    expect(failures.some((item) => item.includes("不一致"))).toBe(true);
  });

  it("包名不符会被拦下——否则会发到错误的 scope", () => {
    const sample = healthyPackage();
    const failures = checkPackage({
      ...sample,
      manifest: { ...sample.manifest, name: "@lingfan-engine/other" },
    });
    expect(failures.some((item) => item.includes("包名不符"))).toBe(true);
  });

  it("缺 src/index.ts 会被拦下——exports 指向的入口不存在", () => {
    const failures = checkPackage({
      ...healthyPackage(),
      entries: ["package/package.json", "package/LICENSE"],
    });
    expect(failures.some((item) => item.includes("src/index.ts"))).toBe(true);
  });

  it("必需字段缺失会逐项报出", () => {
    const failures = checkPackage(
      healthyPackage({ description: undefined, homepage: undefined }),
    );
    expect(failures.filter((item) => item.includes("缺少字段"))).toHaveLength(
      2,
    );
  });
});

describe("跨包一致性判据", () => {
  it("内部依赖范围能匹配本次发布版本时零失败", () => {
    const manifests = {
      "@lingfan-engine/core": { version: "0.1.1" },
      "@lingfan-engine/ui": {
        version: "0.1.1",
        dependencies: { "@lingfan-engine/core": "^0.1.1" },
      },
    };
    expect(checkCrossPackage({ manifests })).toEqual([]);
  });

  it("依赖指向未发布的主版本会被拦下", () => {
    const manifests = {
      "@lingfan-engine/core": { version: "0.2.0" },
      "@lingfan-engine/ui": {
        version: "0.2.0",
        dependencies: { "@lingfan-engine/core": "^0.1.1" },
      },
    };
    const failures = checkCrossPackage({ manifests });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("0.1.1");
  });

  it("依赖了不在发布清单里的内部包会被拦下", () => {
    const manifests = {
      "@lingfan-engine/ui": {
        version: "0.1.1",
        dependencies: { "@lingfan-engine/editor": "^0.1.0" },
      },
    };
    const failures = checkCrossPackage({ manifests });
    expect(failures.some((item) => item.includes("不在发布清单"))).toBe(true);
  });

  it("外部依赖不参与跨包检查", () => {
    const manifests = {
      "@lingfan-engine/ui": {
        version: "0.1.1",
        dependencies: { "@tauri-apps/api": "^2" },
      },
    };
    expect(checkCrossPackage({ manifests })).toEqual([]);
  });
});
