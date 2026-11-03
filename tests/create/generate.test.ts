/**
 * 生成管线（占位符替换 + 清单渲染 + 写盘）的判据测试。
 *
 * 为什么用真实目录：生成器的产物就是磁盘上的文件树，`generateProject` 的写盘、
 * 「目标目录已存在且非空即拒绝」这两条行为只有落到真实文件系统才测得出来。
 * 纯函数部分（`finalize` / `collectDependencyNames`）也一起测，因为它们决定产物字节，
 * 而那正是使用者第一步 `pnpm dev` 成败的地方。
 *
 * 夹具写在 `tests/create/.tmp-generate/` 下：模板样例自建，不依赖仓库里的真实模板
 * （真实模板会随第二批叠加层演进，把它写进断言等于每次改模板都要改测试）。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectDependencyNames,
  generateProject,
  layerBases,
  pinnedNames,
} from "../../packages/create/src/generate/project.ts";
import { finalize } from "../../packages/create/src/generate/project.ts";
import { restoreDotfile } from "../../packages/create/src/generate/dotfiles.ts";
import {
  isTextPath,
  replaceInFile,
  replacePlaceholders,
} from "../../packages/create/src/generate/replace.ts";

const BASE = fileURLToPath(new URL("./.tmp-generate/", import.meta.url));

afterEach(() => {
  rmSync(BASE, { recursive: true, force: true });
});

/** 造一份最小模板：骨架 + 一个框架层 + 一个壳层 */
function makeTemplate(name: string): string {
  const root = join(BASE, name);
  const files: Record<string, string> = {
    "template-meta.json": JSON.stringify({
      version: "1.0.0",
      minEngineVersion: "0.1.0",
      placeholder: "__PROJECT__",
      frameworks: [{ id: "none", label: "骨架", hint: "不叠加" }],
      shells: [{ id: "browser", label: "浏览器", hint: "只出 Web" }],
    }),
    "__PROJECT__/package.json": JSON.stringify(
      {
        name: "__project__",
        scripts: {
          dev: "vite",
          "stories:build": "lingfan-stories-build .",
          "stories:watch": "lingfan-stories-watch .",
        },
        dependencies: { "@lingfan-engine/core": "^0.1.0" },
        // TS 创作链归骨架：缺省故事源形态就是「什么都不叠」，故构建期依赖写在这里
        devDependencies: {
          vite: "^8.0.0",
          "@lingfan-engine/stories-build": "^0.1.0",
          "@lingfan-engine/editor": "^0.1.0",
        },
      },
      null,
      2,
    ),
    "__PROJECT__/index.html": "<title>__PROJECT__</title>",
    "__PROJECT__/Resources/project.json": JSON.stringify({
      id: "__PROJECT__",
      name: "__PROJECT__",
    }),
    "__PROJECT__/Resources/Fonts/demo.ttf": "字体字节占位",
    "overlays/vue/package.patch.json": JSON.stringify({
      dependencies: { vue: "^3.5.0" },
    }),
    "overlays/vue/src/App.vue": "<template>__PROJECT__</template>",
    // 手写故事文件形态：叠在骨架上，摘掉骨架那条 TS 创作链
    "overlays/story/package.patch.json": JSON.stringify({
      create: {
        remove: ["Resources/Stories", "src/Stories.src"],
        unset: {
          scripts: ["stories:build", "stories:watch"],
          devDependencies: ["@lingfan-engine/editor"],
        },
      },
    }),
    "overlays/story/Resources/Stories/title/title_main.story":
      'scene title_main type=ui\n  say "__PROJECT__"\n',
    "overlays/browser/vite.patch.ts": "// browser only __PROJECT__",
  };
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

describe("占位符替换", () => {
  it("大小写两种形态都替换", () => {
    expect(
      replacePlaceholders("__PROJECT__ / __project__", "__PROJECT__", "story"),
    ).toBe("story / story");
  });

  it("未命中的文本原样返回", () => {
    expect(replacePlaceholders("nothing", "__PROJECT__", "story")).toBe(
      "nothing",
    );
  });

  it("按扩展名判文本与二进制", () => {
    expect(isTextPath("a.ts")).toBe(true);
    expect(isTextPath("a.ttf")).toBe(false);
    expect(isTextPath("LICENSE")).toBe(true);
  });

  it("图标与字体这类资源一律当二进制", () => {
    // 桌面壳与移动端会把图标一起带进工程：漏判就会做文本替换，
    // 命中时整块字节错位，图标文件从此打不开。
    for (const path of ["icons/icon.ico", "icons/icon.icns", "icons/a.png"]) {
      expect(isTextPath(path)).toBe(false);
    }
  });

  it("二进制文件不做替换", () => {
    const bytes = Buffer.from("__PROJECT__", "utf8");
    expect(replaceInFile("a.ttf", bytes, "__PROJECT__", "story")).toBe(bytes);
  });

  it("文本文件做替换", () => {
    const out = replaceInFile(
      "a.ts",
      Buffer.from("__PROJECT__", "utf8"),
      "__PROJECT__",
      "story",
    );
    expect(out.toString("utf8")).toBe("story");
  });
});

describe("依赖名收集", () => {
  it("骨架与增量里的依赖都收齐，顺序去重", () => {
    const root = makeTemplate("collect");
    const names = collectDependencyNames(
      layerBases({
        templateRoot: root,
        targetBase: BASE,
        projectName: "story",
        framework: "vue",
        shell: "browser",
        resolved: new Map<string, string>(),
      }),
    );
    // 缺省故事源形态是 ts：整条创作链在骨架里，不叠任何故事源层
    expect(names).toEqual([
      "@lingfan-engine/core",
      "vite",
      "@lingfan-engine/stories-build",
      "@lingfan-engine/editor",
      "vue",
    ]);
  });
});

describe("产物字节", () => {
  it("清单拿到版本号与占位符替换，增量已合入", () => {
    const root = makeTemplate("finalize");
    const options = {
      templateRoot: root,
      targetBase: BASE,
      projectName: "story",
      framework: "vue",
      shell: "browser",
      resolved: new Map<string, string>([["vue", "^9.9.9"]]),
    };
    const result = generateProject(options);
    const manifest = JSON.parse(
      readFileSync(join(result.projectDir, "package.json"), "utf8"),
    ) as {
      name: string;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(manifest.name).toBe("story");
    // 增量合入的新依赖也在解析面内：查到的版本覆盖模板记录的值
    expect(manifest.dependencies).toEqual({
      "@lingfan-engine/core": "^0.1.0",
      vue: "^9.9.9",
    });
    // 缺省 ts 形态：创作链在骨架里，构建期依赖随骨架一起合入
    expect(manifest.devDependencies).toEqual({
      vite: "^8.0.0",
      "@lingfan-engine/stories-build": "^0.1.0",
      "@lingfan-engine/editor": "^0.1.0",
    });
  });

  it("占位符在文本产物里全部替换", () => {
    const root = makeTemplate("replace");
    const result = generateProject({
      templateRoot: root,
      targetBase: BASE,
      projectName: "story",
      framework: "vue",
      shell: "browser",
      resolved: new Map<string, string>(),
    });
    expect(readFileSync(join(result.projectDir, "index.html"), "utf8")).toBe(
      "<title>story</title>",
    );
    expect(readFileSync(join(result.projectDir, "src/App.vue"), "utf8")).toBe(
      "<template>story</template>",
    );
    expect(
      JSON.parse(
        readFileSync(join(result.projectDir, "Resources/project.json"), "utf8"),
      ),
    ).toEqual({ id: "story", name: "story" });
  });

  it("二进制资源按字节原样复制", () => {
    const root = makeTemplate("binary");
    const result = generateProject({
      templateRoot: root,
      targetBase: BASE,
      projectName: "story",
      framework: "none",
      shell: "browser",
      resolved: new Map<string, string>(),
    });
    expect(
      readFileSync(join(result.projectDir, "Resources/Fonts/demo.ttf"), "utf8"),
    ).toBe("字体字节占位");
  });

  it("patch 文件不进产物", () => {
    const root = makeTemplate("nopatch");
    const result = generateProject({
      templateRoot: root,
      targetBase: BASE,
      projectName: "story",
      framework: "vue",
      shell: "browser",
      resolved: new Map<string, string>(),
    });
    const finalized = finalize(
      [],
      undefined,
      new Map(),
      "__PROJECT__",
      "story",
    );
    expect(finalized).toEqual([]);
    let found = false;
    try {
      readFileSync(join(result.projectDir, "package.patch.json"));
      found = true;
    } catch {
      found = false;
    }
    expect(found).toBe(false);
  });
});

describe("钉住的依赖", () => {
  it("增量点名的包保持模板版本，不进解析结果", () => {
    // 上游并非都兼容：vue-tsc 在 typescript 7 上会因 ./lib/tsc 不再导出而直接崩，
    // 这类约束只有模板作者知道，所以允许增量声明「这个包别跟最新」。
    const root = makeTemplate("pinned");
    const patch = join(root, "overlays/vue/package.patch.json");
    writeFileSync(
      patch,
      JSON.stringify({
        dependencies: { vue: "^3.5.0" },
        create: { pinned: ["vite"] },
      }),
    );
    const result = generateProject({
      templateRoot: root,
      targetBase: BASE,
      projectName: "story",
      framework: "vue",
      shell: "browser",
      resolved: new Map<string, string>([
        ["vue", "3.9.0"],
        ["vite", "9.0.0"],
      ]),
    });
    const manifest = JSON.parse(
      readFileSync(join(result.projectDir, "package.json"), "utf8"),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      create?: unknown;
    };
    expect(manifest.devDependencies.vite).toBe("^8.0.0");
    expect(manifest.dependencies.vue).toBe("^3.9.0");
    // 生成期指令不是产物字段：写进清单会让 npm 与读者都看到未知键
    expect(manifest.create).toBeUndefined();
  });

  it("没有增量时不钉任何包", () => {
    expect(pinnedNames(undefined)).toEqual([]);
    expect(pinnedNames({ dependencies: { vue: "^3" } })).toEqual([]);
    expect(pinnedNames({ create: { pinned: "vite" } })).toEqual([]);
  });
});

describe("点文件名还原", () => {
  it("模板里的 gitignore 在产物里变回 .gitignore", () => {
    // npm 安装时会把包内的 .gitignore 改名成 .npmignore，所以模板只能存成普通名，
    // 由生成器改回来——否则新工程拿不到忽略规则，node_modules/ 与 dist/ 会被误提交。
    expect(restoreDotfile("gitignore")).toBe(".gitignore");
  });

  it("已经是点名的文件不再处理", () => {
    expect(restoreDotfile(".gitignore")).toBe(".gitignore");
    expect(restoreDotfile("package.json")).toBe("package.json");
  });

  it("嵌套目录里的同名文件不动", () => {
    expect(restoreDotfile("Resources/gitignore")).toBe("Resources/gitignore");
  });
});

describe("层序与写盘", () => {
  it("层序为骨架 → 框架 → 故事源 → 壳", () => {
    const root = makeTemplate("layers");
    expect(
      layerBases({
        templateRoot: root,
        targetBase: BASE,
        projectName: "story",
        framework: "vue",
        sources: "story",
        shell: "browser",
        resolved: new Map<string, string>(),
      }),
    ).toEqual([
      join(root, "__PROJECT__"),
      join(root, "overlays", "vue"),
      join(root, "overlays", "story"),
      join(root, "overlays", "browser"),
    ]);
  });

  it("故事源形态缺省为 ts：骨架自带创作链，不叠故事源层", () => {
    // 三种创作形态是同一架构的三条入口，不是三档能力：TS 源编译成故事文件，
    // 与手写 `.story` / `.json` 落在同一棵资源树。缺省取 TS 是因为它能力最强、
    // 产物同构——不改变任何运行期语义。整条链在骨架里，所以 `ts` 是零改动形态。
    const root = makeTemplate("sources-default");
    expect(
      layerBases({
        templateRoot: root,
        targetBase: BASE,
        projectName: "story",
        framework: "vue",
        shell: "browser",
        resolved: new Map<string, string>(),
      }),
    ).toEqual([
      join(root, "__PROJECT__"),
      join(root, "overlays", "vue"),
      join(root, "overlays", "browser"),
    ]);
  });

  it("没有叠加层目录的形态直接跳过，不占位", () => {
    // `none`（骨架框架）与 `browser`（浏览器壳）都是零改动形态：模板里没有
    // 对应目录不是错误，只是「这一层什么都不加」。
    const root = makeTemplate("defaults");
    expect(
      layerBases({
        templateRoot: root,
        targetBase: BASE,
        projectName: "story",
        framework: "none",
        shell: "browser",
        resolved: new Map<string, string>(),
      }),
    ).toEqual([join(root, "__PROJECT__"), join(root, "overlays", "browser")]);
  });

  it("故事文件形态摘掉骨架的 TS 创作链，换成手写故事", () => {
    const root = makeTemplate("story-overlay");
    const result = generateProject({
      templateRoot: root,
      targetBase: BASE,
      projectName: "story",
      framework: "none",
      sources: "story",
      shell: "browser",
      resolved: new Map<string, string>(),
    });
    // 摘掉的路径不再出现在产物里
    expect(existsSync(join(result.projectDir, "src/Stories.src"))).toBe(false);
    expect(
      existsSync(
        join(result.projectDir, "Resources/Stories/title/title_main.story"),
      ),
    ).toBe(true);
  });

  it("故事文件形态连配套的脚本与创作期依赖一起摘掉", () => {
    // 反向叠加层摘走 TS 创作链之后，配套命令与依赖必须一起消失：
    // 留着一个指向已删除目录的 `stories:build`，使用者照文档跑一次就会失败。
    const root = makeTemplate("story-unset");
    const result = generateProject({
      templateRoot: root,
      targetBase: BASE,
      projectName: "story",
      framework: "none",
      sources: "story",
      shell: "browser",
      resolved: new Map<string, string>(),
    });
    const manifest = JSON.parse(
      readFileSync(join(result.projectDir, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(manifest.scripts?.["stories:build"]).toBeUndefined();
    expect(manifest.scripts?.["stories:watch"]).toBeUndefined();
    expect(manifest.devDependencies["@lingfan-engine/editor"]).toBeUndefined();
    // 只摘点名的键：其余依赖原样保留
    expect(manifest.devDependencies["@lingfan-engine/stories-build"]).toBe(
      "^0.1.0",
    );
    expect(manifest.devDependencies.vite).toBe("^8.0.0");
  });

  it("目标目录已存在且非空时拒绝生成", () => {
    const root = makeTemplate("occupied");
    const options = {
      templateRoot: root,
      targetBase: BASE,
      projectName: "story",
      framework: "none",
      shell: "browser",
      resolved: new Map<string, string>(),
    };
    generateProject(options);
    expect(() => generateProject(options)).toThrow(/已存在且非空/);
  });
});
