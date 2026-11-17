/**
 * 发布前自检的判据测试。
 *
 * 判据本身是纯函数（喂一份元数据与文件清单，看是否报出问题），因此这里直接构造样本，
 * 不去跑真实的打包——打包耗时且依赖工作区状态，属于 `pnpm publish:check` 的职责。
 *
 * 为什么要测判据而不只测脚本能跑：这些判据拦的是「发布成功、消费方装不上」的缺陷，
 * 一旦判据本身写错，事故不会在本地暴露，只会在装包时暴露。判据必须自己先被钉住。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  parseTarListing: (stdout: string) => string[];
  collectExportTargets: (exports: unknown) => string[];
  publishedPackageDirs: () => string[];
}

const publishCheck = (await import(
  /* @vite-ignore */ new URL("../../scripts/publish-check.mjs", import.meta.url)
    .href
)) as PublishCheckModule;
const {
  PUBLISHED_PACKAGES,
  checkPackage,
  checkCrossPackage,
  parseTarListing,
  collectExportTargets,
  publishedPackageDirs,
} = publishCheck;

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
      "@lingfan-engine/create",
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

/**
 * tar 列表解析的行尾兼容。
 *
 * Windows 的 GNU tar 输出 CRLF 行尾；条目若带着尾随 `\r`，LICENSE 的全等匹配
 * 与入口/禁带的 `$` 锚正则会全部失配——健康包被误报缺件、禁带文件反而漏网。
 * 这里直接喂模拟的 tar 列表输出，把两种行尾下的判据行为都钉住。
 */
describe("tar 列表解析（CRLF 兼容）", () => {
  it("CRLF 行尾洗净，条目不带尾随 \\r", () => {
    expect(
      parseTarListing("package/LICENSE\r\npackage/src/index.ts\r\n"),
    ).toEqual(["package/LICENSE", "package/src/index.ts"]);
  });

  it("LF 输入行为不变", () => {
    expect(parseTarListing("package/LICENSE\npackage/src/index.ts\n")).toEqual([
      "package/LICENSE",
      "package/src/index.ts",
    ]);
  });

  it("空列表返回空数组", () => {
    expect(parseTarListing("")).toEqual([]);
  });

  it("尾随换行不产生空条目", () => {
    expect(parseTarListing("package/a\n")).toEqual(["package/a"]);
  });

  it("CRLF 与 LF 混合行尾都能处理", () => {
    expect(parseTarListing("package/a\r\npackage/b\n")).toEqual([
      "package/a",
      "package/b",
    ]);
  });

  it("CRLF 列表下 LICENSE 与主入口检查恢复（健康包零失败）", () => {
    const sample = healthyPackage();
    const crlf = `${sample.entries.join("\r\n")}\r\n`;
    expect(checkPackage({ ...sample, entries: parseTarListing(crlf) })).toEqual(
      [],
    );
  });

  it("CRLF 列表下禁带测试文件仍被拦下", () => {
    const sample = healthyPackage();
    const entries = [...sample.entries, "package/src/x.test.ts"];
    const crlf = `${entries.join("\r\n")}\r\n`;
    const failures = checkPackage({
      ...sample,
      entries: parseTarListing(crlf),
    });
    expect(failures.some((item) => item.includes("x.test.ts"))).toBe(true);
  });

  it("清洗不掩盖真实缺失：LICENSE 真缺仍红", () => {
    const sample = healthyPackage();
    const entries = sample.entries.filter(
      (entry) => entry !== "package/LICENSE",
    );
    const crlf = `${entries.join("\r\n")}\r\n`;
    const failures = checkPackage({
      ...sample,
      entries: parseTarListing(crlf),
    });
    expect(failures.some((item) => item.includes("LICENSE"))).toBe(true);
  });
});

/**
 * exports 子路径目标必须在包内。
 *
 * 主入口检查只钉 src/index.ts；子路径（如 core 的 ./script）目标被 files 漏掉时，
 * 消费方的深路径 import 发布后悬空，而主入口检查仍全绿。这里用样本钉住「缺失必红」，
 * 并对真实清单做一次冒烟：现仓全部 exports 目标都必须在磁盘上存在。
 */
describe("exports 子路径判据", () => {
  it("子路径目标不在包内会被拦下（恰一条且点名子路径）", () => {
    const failures = checkPackage(
      healthyPackage({
        exports: { ".": "./src/index.ts", "./script": "./src/script/index.ts" },
      }),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("./script");
  });

  it("子路径目标全部在包内时零失败", () => {
    const sample = healthyPackage({
      exports: { ".": "./src/index.ts", "./script": "./src/script/index.ts" },
    });
    expect(
      checkPackage({
        ...sample,
        entries: [...sample.entries, "package/src/script/index.ts"],
      }),
    ).toEqual([]);
  });

  it("条件对象的每个分支都要求在包内：缺 default 目标会被拦下", () => {
    const sample = healthyPackage({
      exports: {
        ".": "./src/index.ts",
        "./dev": { types: "./src/dev/index.ts", default: "./dev.mjs" },
      },
    });
    const failures = checkPackage({
      ...sample,
      entries: [...sample.entries, "package/src/dev/index.ts"],
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("./dev.mjs");
  });

  it("数组的每个 fallback 都要求在包内：缺一被拦；null 屏蔽不报", () => {
    const sample = healthyPackage({
      exports: {
        ".": "./src/index.ts",
        "./alt": ["./src/alt-a.ts", "./src/alt-b.ts"],
        "./blocked": null,
      },
    });
    const failures = checkPackage({
      ...sample,
      entries: [...sample.entries, "package/src/alt-a.ts"],
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("./src/alt-b.ts");
    expect(
      checkPackage({
        ...sample,
        entries: [
          ...sample.entries,
          "package/src/alt-a.ts",
          "package/src/alt-b.ts",
        ],
      }),
    ).toEqual([]);
  });

  it("collectExportTargets：string/条件对象/数组/null 四形态收集结果钉死", () => {
    expect(collectExportTargets("./src/index.ts")).toEqual(["./src/index.ts"]);
    expect(
      collectExportTargets({
        types: "./src/dev/index.ts",
        default: "./dev.mjs",
      }),
    ).toEqual(["./src/dev/index.ts", "./dev.mjs"]);
    expect(collectExportTargets(["./a.ts", "./b.ts"])).toEqual([
      "./a.ts",
      "./b.ts",
    ]);
    expect(collectExportTargets(null)).toEqual([]);
    expect(collectExportTargets(undefined)).toEqual([]);
  });

  it("真实清单冒烟：发布包的每个 exports 目标都在磁盘上存在", () => {
    const dirs = publishedPackageDirs();
    expect(dirs).toHaveLength(PUBLISHED_PACKAGES.length);
    for (const dir of dirs) {
      const manifest = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf8"),
      ) as { name: string; exports: unknown };
      const targets = collectExportTargets(manifest.exports);
      expect(targets.length, `${dir} 没有 exports 目标`).toBeGreaterThan(0);
      for (const target of targets) {
        const file = join(dir, target.replace(/^\.\//, ""));
        expect(
          existsSync(file),
          `${manifest.name}: exports 目标 ${target} 不存在`,
        ).toBe(true);
      }
    }
  });
});
