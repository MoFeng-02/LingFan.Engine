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
  readdirSync,
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
  projectDirOf,
} from "../../packages/create/src/generate/project.ts";
import {
  mergeLayers,
  pinnedNames,
} from "../../packages/create/src/overlay/merge.ts";
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
    // 机制夹具：这里用 story 层演示「摘文件 + 摘清单键」，真实模板的 story 层
    // 只做加法（另附一份手写示例、不摘任何骨架文件）。夹具测的是合并机制本身，
    // 因此不随真实模板的语义调整而变。
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
      [],
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

  it("多个叠加层各钉各的，并集全部生效", () => {
    // 钉住是「累加声明」不是「覆盖声明」：每个叠加层只知道自己关心的那几个包，
    // 框架层钉 typescript、壳层钉自己的工具链，两者必须同时生效。若按深合并
    // 取后一层，先声明的钉法会被静默抹掉——上游兼容性约束丢了却没有任何报错。
    const root = makeTemplate("pinned-union");
    writeFileSync(
      join(root, "overlays/vue/package.patch.json"),
      JSON.stringify({
        dependencies: { vue: "^3.5.0" },
        create: { pinned: ["vite"] },
      }),
    );
    writeFileSync(
      join(root, "overlays/browser/package.patch.json"),
      JSON.stringify({
        create: { pinned: ["@lingfan-engine/core"] },
      }),
    );
    const bases = layerBases({
      templateRoot: root,
      targetBase: BASE,
      projectName: "story",
      framework: "vue",
      shell: "browser",
      resolved: new Map<string, string>(),
    });
    expect(mergeLayers(bases).pinned).toEqual(["vite", "@lingfan-engine/core"]);
    const result = generateProject({
      templateRoot: root,
      targetBase: BASE,
      projectName: "story",
      framework: "vue",
      shell: "browser",
      resolved: new Map<string, string>([
        ["vue", "3.9.0"],
        ["vite", "9.0.0"],
        ["@lingfan-engine/core", "9.0.0"],
      ]),
    });
    const manifest = JSON.parse(
      readFileSync(join(result.projectDir, "package.json"), "utf8"),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    // 两层各自钉住的包都保留模板区间，未被钉的照常解析到最新
    expect(manifest.devDependencies.vite).toBe("^8.0.0");
    expect(manifest.dependencies["@lingfan-engine/core"]).toBe("^0.1.0");
    expect(manifest.dependencies.vue).toBe("^3.9.0");
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

  it("叠加层可摘掉骨架里的文件", () => {
    // 机制层面：`create.remove` 摘掉的路径不再出现在产物里，本层自己的文件照常落地。
    // 夹具拿 story 层演示，真实模板的 story 层只做加法，摘除能力由别的层按需使用。
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

  it("摘除同时可摘清单里的脚本与依赖", () => {
    // 反向叠加层摘走骨架的一部分之后，配套命令与依赖必须一起消失：
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

  it("选 ignore 时保留目录里的其他文件，只覆盖同名文件", () => {
    // 使用者的常见情形：目标目录里已经放过 README 或素材，只想补上模板的文件。
    // 这时唯一能保证的是「模板里的路径被重写」，不能顺手删掉别人的东西。
    const root = makeTemplate("occupied-ignore");
    const options = {
      templateRoot: root,
      targetBase: BASE,
      projectName: "story",
      framework: "none",
      shell: "browser",
      resolved: new Map<string, string>(),
    };
    const dir = projectDirOf(options);
    generateProject(options);
    writeFileSync(join(dir, "notes.txt"), "keep me", "utf8");
    writeFileSync(join(dir, "package.json"), "stale", "utf8");

    const result = generateProject({ ...options, existing: "ignore" });

    expect(result.projectDir).toBe(dir);
    expect(readFileSync(join(dir, "notes.txt"), "utf8")).toBe("keep me");
    // 同名文件按模板重写，不是继续沿用目录里那份
    expect(readFileSync(join(dir, "package.json"), "utf8")).toContain(
      "@lingfan-engine/core",
    );
  });

  it("选 clear 时先清空目录里的内容再生成", () => {
    const root = makeTemplate("occupied-clear");
    const options = {
      templateRoot: root,
      targetBase: BASE,
      projectName: "story",
      framework: "none",
      shell: "browser",
      resolved: new Map<string, string>(),
    };
    const dir = projectDirOf(options);
    generateProject(options);
    writeFileSync(join(dir, "notes.txt"), "gone", "utf8");
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "scripts", "old.mjs"), "gone", "utf8");

    generateProject({ ...options, existing: "clear" });

    expect(existsSync(join(dir, "notes.txt"))).toBe(false);
    expect(existsSync(join(dir, "scripts", "old.mjs"))).toBe(false);
    // 目录本身还在：调用方可能把 shell 的 cwd 放在里面
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(join(dir, "package.json"))).toBe(true);
  });
});

/**
 * 描述写两处：`package.json` 给开发者与 npm 工具链看，`Resources/project.json`
 * 跟资源走、供运行时与构建期读。两处同源同值，是「一个变量写两处」而不是两套规则。
 *
 * 没有描述时两处都必须**不出现该键**，而不是写空串——空串会让「没填」与「填了个空」
 * 没法区分，也会让缺省产物与旧版本逐字节不一致。
 */
describe("描述写入两份清单", () => {
  /** 读产物里两份清单 */
  function manifestsOf(projectDir: string): {
    pkg: Record<string, unknown>;
    project: Record<string, unknown>;
  } {
    return {
      pkg: JSON.parse(
        readFileSync(join(projectDir, "package.json"), "utf8"),
      ) as Record<string, unknown>,
      project: JSON.parse(
        readFileSync(join(projectDir, "Resources/project.json"), "utf8"),
      ) as Record<string, unknown>,
    };
  }

  it("有描述时两处都写同一个值", () => {
    const root = makeTemplate("desc-on");
    const result = generateProject({
      templateRoot: root,
      targetBase: BASE,
      projectName: "with-description",
      description: "试菜单的小工程",
      framework: "none",
      shell: "browser",
      resolved: new Map<string, string>(),
    });
    const { pkg, project } = manifestsOf(result.projectDir);
    expect(pkg.description).toBe("试菜单的小工程");
    expect(project.description).toBe("试菜单的小工程");
  });

  it("没有描述时两处都不出现该键", () => {
    const root = makeTemplate("desc-off");
    const result = generateProject({
      templateRoot: root,
      targetBase: BASE,
      projectName: "without-description",
      framework: "none",
      shell: "browser",
      resolved: new Map<string, string>(),
    });
    const { pkg, project } = manifestsOf(result.projectDir);
    expect("description" in pkg).toBe(false);
    expect("description" in project).toBe(false);
  });

  it("空串等同于没有描述", () => {
    // 问答里「回车留空」拿到的就是空串；它必须与省略参数走同一条路径，
    // 否则「空」会以两种形态出现在产物里。
    const root = makeTemplate("desc-empty");
    const result = generateProject({
      templateRoot: root,
      targetBase: BASE,
      projectName: "empty-description",
      description: "",
      framework: "none",
      shell: "browser",
      resolved: new Map<string, string>(),
    });
    const { pkg, project } = manifestsOf(result.projectDir);
    expect("description" in pkg).toBe(false);
    expect("description" in project).toBe(false);
  });

  it("描述之外的键位与取值原样保留", () => {
    const root = makeTemplate("desc-shape");
    const result = generateProject({
      templateRoot: root,
      targetBase: BASE,
      projectName: "descr-shape",
      description: "带描述的产物",
      framework: "vue",
      shell: "browser",
      resolved: new Map<string, string>(),
    });
    const { pkg, project } = manifestsOf(result.projectDir);
    // 层补丁与占位符替换照旧生效：描述是「加一个键」，不是「重写清单」
    expect(pkg.name).toBe("descr-shape");
    expect((pkg.dependencies as Record<string, string>).vue).toBe("^3.5.0");
    expect(project.id).toBe("descr-shape");
    expect(project.name).toBe("descr-shape");
  });
});

/**
 * `makeTemplate()` 这份最小模板（骨架四个文件 + 框架层一个 + 故事源层一个
 * + 壳层一个，`*.patch.json` 不进产物）生成出来的文件总数。
 *
 * 为什么值得钉死：这个数字是叠加层合并、`create.remove`、点文件名还原、
 * 清单渲染共同作用的结果，任何一处行为漂移都会改它——而它恰好是使用者
 * 第一眼能感知的东西（「生成了多少个文件」）。此前只能靠真跑矩阵人工核对。
 */
const SKELETON_MINIMAL_FILE_COUNT = 7;

/** 递归数目录下的文件数（只数文件，不数目录） */
function countFiles(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? countFiles(path) : 1;
  }
  return total;
}

describe("产物文件数", () => {
  it("最小模板的产物文件数固定", () => {
    const root = makeTemplate("file-count");
    const result = generateProject({
      templateRoot: root,
      targetBase: BASE,
      projectName: "minimal-count",
      framework: "vue",
      sources: "story",
      shell: "browser",
      resolved: new Map<string, string>(),
    });
    // 两条口径互相印证：结果对象报的数就是磁盘上真正落下的文件数
    expect(result.fileCount).toBe(SKELETON_MINIMAL_FILE_COUNT);
    expect(countFiles(result.projectDir)).toBe(SKELETON_MINIMAL_FILE_COUNT);
  });
});
