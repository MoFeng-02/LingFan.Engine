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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectDependencyNames,
  generateProject,
  layerBases,
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
        dependencies: { "@lingfan-engine/core": "^0.1.0" },
        devDependencies: { vite: "^8.0.0" },
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
    expect(names).toEqual(["@lingfan-engine/core", "vite", "vue"]);
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
    expect(manifest.devDependencies).toEqual({ vite: "^8.0.0" });
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
  it("层序为骨架 → 框架 → 壳", () => {
    const root = makeTemplate("layers");
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

  it("缺省项没有叠加层目录时只留骨架", () => {
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
