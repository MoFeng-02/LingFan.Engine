/**
 * 故事源工程的「就近选择」判据：编辑器与类型检查必须看同一份类型面。
 *
 * 背景（真实缺陷）：宿主工程（工程根那份 tsconfig.json）明确排除 `src/Stories.src/**`
 * ——组件编译器会把 `*.vue` / `*.tsx` 解析成真组件，盖过创作垫片声明的 UI 句柄通配。
 * 代价是编辑器按「离文件最近的那份 tsconfig.json」挑工程时，章节源落进推断工程：
 * `state` / `defineVars` / `StoriesConfig` 这些环境全局不在程序里，于是报
 * 「找不到名称 state」；而类型检查本身是干净的（它走 `tsconfig.stories.json`）。
 *
 * 修法是给故事源自带一份就近工程，继承那份 stories 工程——编辑器挑到它，
 * 门禁跑的还是原来那份，两边共用同一套 compilerOptions。
 *
 * 判据落在两处事实上：
 * - 就近工程继承的正是 stories 工程（不是各写一套 compilerOptions）；
 * - 两份工程装的是**同一个程序**：`tsc --listFiles` 比对，两边纳入的文件集合
 *   逐个相同。这条比「零错」更强——零错只说明当前源码碰巧没触发错误，
 *   程序一致才说明编辑器与门禁看的是同一份类型面。
 *
 * 并发口径：真实工程的回归锚点（`tests/stories-build/playground-anchor.test.ts`）
 * 会在故事源目录里临时落几个探针文件，其中一个是**故意写错类型**的负例探针。
 * 本判据扫的正是那棵树，两边并行时既可能多看到一个探针文件、也可能撞上那个
 * 故意报错的探针——那不是回归，是别人正在施工。故：文件清单比对先滤掉探针，
 * 诊断只允许落在探针上；用例带重试，与锚点文件同口径。
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TSC_BIN = fileURLToPath(
  new URL("../../node_modules/typescript/bin/tsc", import.meta.url),
);

/** 仓内真实工程与脚手架模板：两处都要有就近工程，否则交付出去的那份仍是假红 */
const TARGETS = [
  { id: "playground", root: "apps/playground" },
  { id: "模板骨架", root: "template/v1/__PROJECT__" },
] as const;

/** 回归锚点临时落的探针文件：文件名以 `-probe.ts` 结尾 */
const PROBE_FILE = /-probe\.ts$/;

/** 就近工程路径（相对仓根） */
function nearestConfig(root: string): string {
  return `${root}/src/Stories.src/tsconfig.json`;
}

/** 跑一次 tsc，返回退出码、诊断输出与纳入的文件清单 */
function runTsc(project: string): {
  status: number;
  output: string;
  files: string[];
} {
  const run = spawnSync(
    process.execPath,
    [TSC_BIN, "--noEmit", "-p", project, "--listFiles"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
    },
  );
  const lines = `${run.stdout ?? ""}${run.stderr ?? ""}`.split(/\r?\n/);
  const root = REPO_ROOT.replace(/\\/g, "/");
  // --listFiles 的清单以绝对路径逐行列出；诊断行是相对路径，两者据此分开
  const files = lines
    .filter((line) => line.startsWith(root))
    .map((line) => line.trim())
    .sort();
  const output = lines
    .filter((line) => line.trim() !== "" && !line.startsWith(root))
    .join("\n");
  return { status: run.status ?? -1, output, files };
}

/** 诊断里的报错行：形如 `src/Stories.src/chapter1/xxx.ts(3,3): error TS2322: …` */
function errorLines(output: string): string[] {
  return output.split(/\r?\n/).filter((line) => line.includes("error TS"));
}

describe("故事源的就近工程：编辑器与类型检查看同一份类型面", () => {
  it("两处都有就近工程，且继承的正是那份 stories 工程", () => {
    for (const target of TARGETS) {
      const path = nearestConfig(target.root);
      const source = readFileSync(`${REPO_ROOT}${path}`, "utf8");
      expect(
        source,
        `${path} 必须继承 stories 工程（两份工程共用同一套 compilerOptions）`,
      ).toContain('"extends": "../../tsconfig.stories.json"');
    }
  });

  it(
    "就近工程与 stories 工程装的是同一个程序",
    { retry: 1, timeout: 120000 },
    () => {
      for (const target of TARGETS) {
        const nearest = runTsc(nearestConfig(target.root));
        const stories = runTsc(`${target.root}/tsconfig.stories.json`);
        expect(nearest.status, `就近工程编译失败：${nearest.output}`).toBe(0);
        expect(stories.status, `stories 工程编译失败：${stories.output}`).toBe(
          0,
        );
        // 报错只允许落在别人正在落的探针上——那不是本工程的问题
        const offenders = errorLines(nearest.output).filter(
          (line) => !PROBE_FILE.test(line),
        );
        expect(
          offenders,
          `${target.id} 的就近工程报错：${offenders.join("\n")}`,
        ).toEqual([]);
        expect(
          nearest.files.filter((file) => !PROBE_FILE.test(file)),
          `${target.id} 的就近工程与 stories 工程纳入的文件集合不同：编辑器与门禁看的不是同一份类型面`,
        ).toEqual(stories.files.filter((file) => !PROBE_FILE.test(file)));
      }
    },
  );

  it(
    "故事源与生成物类型面都在程序里：ambient 全局不缺席",
    { retry: 1, timeout: 120000 },
    () => {
      for (const target of TARGETS) {
        const files = runTsc(nearestConfig(target.root)).files;
        expect(
          files.some((file) => file.includes("/src/Stories.src/")),
          `${target.id} 的就近工程没装故事源`,
        ).toBe(true);
        expect(
          files.some((file) => file.includes("/src/gen/state.gen.d.ts")),
          `${target.id} 的就近工程没装生成物类型面（state 桥会缺席）`,
        ).toBe(true);
      }
    },
  );
});
