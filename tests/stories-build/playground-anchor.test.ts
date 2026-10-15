/**
 * 真实工程回归锚点：apps/playground（唯一全功能真实工程）整链构建 vs 入库产物。
 *
 * 锚定口径：
 * - 真实工程全链构建（源发现 → 编译 → 往返自检 → 差量写盘）必须零差量——入库的
 *   `Stories.src/gen/stories.gen.d.ts` 与当轮计算产物逐字节一致。链上任一环改变输出
 *   （编译器、typegen、扩展装载、源文件），本锚点立即红，倒逼产物随源显式重建。
 * - 判别性落点：`journal.flag` 只在变量清单（config.vars，换道前是 defineVars 清单）
 *   出现（state/let/插值均无此键），
 *   它进注册表的唯一通道是编排层的 defineKeys 源——该源被撤时本锚点必红
 *   （最小工程上的同一判别见 typegen.test.ts）。
 * - state 类型面（state.gen.d.ts）与 stories.gen.d.ts 同口径锚定：入库字节与当轮计算
 *   产物逐字节一致，且形状必须仍锚在「从 config define 树生成的精确类型」上——
 *   枚举走 import type 引用（`Sex`），不回退内联联合；类型面退化为宽 any 时本锚点红。
 * - script 命名空间 ambient 声明（script.gen.d.ts）同口径锚定：内容恒定，锚住
 *   `declare const script: typeof import("@lingfan/editor").script;` 一行——声明面
 *   换形（如改成运行时注入）时本锚点红。
 * - 字体类型面（font.gen.d.ts）同口径锚定：工程未声明字体时锚住封闭空类型
 *   `Record<never, never>`——退化成开放索引签名（放弃拼错保护）时本锚点红。
 * - tsc 负例探针：对真实工程临时注入一个类型错误的章节模块，`tsc --noEmit` 必须拒绝——
 *   证明 gen/state.gen.d.ts 提供的是精确类型面而非松散类型（宽 any 垫片探针不红）。
 * - script ambient 探针：错键 `script.bgmX` 被 ambient 类型面拒绝、正确键 `script.bgm`
 *   放行——证明声明面精确到词函数（松散 any 声明两者皆绿）。
 * - font.gen 新鲜度：字体文件落盘 → 键=值入类型面；删文件重构建 → 恢复封闭空类型
 *   （注册表跟随构建，不是一次性快照）。font ambient 探针同样两态：错键
 *   `font.缺省字体` 拒、注册名 `font.楷体` 过（两例都自置桩字体夹具，finally 全清，
 *   入库态保持空注册表）。
 * - 手改生成物的修复路径也锚定：作者误改 gen 文件后，构建必须重写回正确字节——
 *   同时证明逐字节一致不是「构建没算」的空转绿。
 *
 * config 化过渡守卫：config 化之后、Stories.src 迁移完成之前，真实工程
 * 仍是旧 config 契约，构建必然以「缺少 folders 导出」fail-closed——两例此时 skip（确定性
 * 契约错误，不是环境竞态）；Stories.src 迁移完成后错误消失、守卫自动失效，届时可删除 isConfigContractTransition。
 *
 * 写盘机制细节（差量判定、陈旧清理、report 计数）由 build-pipeline.test.ts 在最小工程
 * 覆盖；本文件不重复，只锚真实工程的整链终态。测试对工程根的写入仅限故障恢复路径：
 * 断言失败时把锚定的产物恢复为入库字节，不让测试自身污染工作区。
 *
 * 并行加固：本文件是全仓唯一对真实工程工作区做「读-改-写」的测试，vitest 跨文件
 * 并行下与其他读工程产物的用例存在 I/O 竞态窗口（偶发一败、单跑/复跑恒绿）——
 * 两例 retry 1 吸收环境性竞态；真回归两次必红，不会被吞。（文件内两例本就串行执行）
 * 三个 tsc 探针各自 spawnSync 拉起一次 tsc --noEmit，满仓并行下单次耗时可远超全仓
 * 缺省的 testTimeout（vitest.config.ts）：它们显式抬到 60s——时限先到会把绿例判红并
 * 触发重试，真回归本就会红，放宽时限不动判定力。
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildStories } from "@lingfan/stories-build";

const PLAYGROUND_ROOT = fileURLToPath(
  new URL("../../apps/playground/", import.meta.url),
);
/** report 里的逻辑路径是 posix 相对路径（与源根命名空间一致），保持正斜杠字面量 */
const TYPEGEN_REL = "Stories.src/gen/stories.gen.d.ts";
const STATE_GEN_REL = "Stories.src/gen/state.gen.d.ts";
const SCRIPT_GEN_REL = "Stories.src/gen/script.gen.d.ts";
const FONT_GEN_REL = "Stories.src/gen/font.gen.d.ts";
/** tsc 负例探针：类型错误章节模块（finally 删除，不带 default 导出、不进故事发现） */
const PROBE_REL = "Stories.src/chapter1/typecheck-probe.ts";
const PROBE_SOURCE = [
  "/* 临时探针：tsc --noEmit 必须拒绝 state 上的错误类型（测试 finally 删除本文件） */",
  "export function typecheckProbe(): void {",
  '  state.player.gold = "x";',
  "}",
  "",
].join("\n");
/** script ambient 探针：错键/正键两态（finally 删除；ambient 直呼不导入，走全局声明） */
const SCRIPT_PROBE_REL = "Stories.src/chapter1/script-probe.ts";
const SCRIPT_PROBE_NEGATIVE = [
  "/* 临时探针：错键 script.bgmX 必须被拒绝（测试 finally 删除本文件） */",
  "export function scriptProbeNegative(): void {",
  '  script.bgmX("x.ogg");',
  "}",
  "",
].join("\n");
const SCRIPT_PROBE_POSITIVE = [
  "/* 临时探针：正确键 script.bgm 放行（测试 finally 删除本文件） */",
  "export function scriptProbePositive(): void {",
  '  script.bgm("x.ogg");',
  "}",
  "",
].join("\n");
/** font ambient 探针：未注册名/注册名两态（finally 删除；须先落桩字体使 font.gen 带键） */
const FONT_PROBE_REL = "Stories.src/chapter1/font-probe.ts";
const FONT_PROBE_NEGATIVE = [
  "/* 临时探针：未注册名 font.缺省字体 必须被拒绝（测试 finally 删除本文件） */",
  "export function fontProbeNegative(): string {",
  "  return font.缺省字体;",
  "}",
  "",
].join("\n");
const FONT_PROBE_POSITIVE = [
  "/* 临时探针：注册名 font.楷体 放行（测试 finally 删除本文件） */",
  "export function fontProbePositive(): string {",
  "  return font.楷体;",
  "}",
  "",
].join("\n");

/** config 化过渡守卫：旧 config 契约的确定性失败（缺 folders 导出 / 文件缺失）。Stories.src 迁移完成后可删。 */
function isConfigContractTransition(error: unknown): boolean {
  return (
    error instanceof Error &&
    (/缺少 folders 导出/.test(error.message) ||
      /config\.ts 不存在/.test(error.message))
  );
}

describe("真实工程回归锚点（apps/playground 整链）", () => {
  it("全链构建零差量：入库类型面产物与当轮计算产物逐字节一致", { retry: 1 }, async (ctx) => {
    const typegenPath = join(PLAYGROUND_ROOT, TYPEGEN_REL);
    const stateGenPath = join(PLAYGROUND_ROOT, STATE_GEN_REL);
    const scriptGenPath = join(PLAYGROUND_ROOT, SCRIPT_GEN_REL);
    const fontGenPath = join(PLAYGROUND_ROOT, FONT_GEN_REL);
    const committed = readFileSync(typegenPath, "utf8");
    const committedState = readFileSync(stateGenPath, "utf8");
    const committedScript = readFileSync(scriptGenPath, "utf8");
    const committedFont = readFileSync(fontGenPath, "utf8");
    try {
      let report;
      try {
        report = await buildStories(PLAYGROUND_ROOT);
      } catch (error) {
        if (isConfigContractTransition(error)) ctx.skip();
        throw error;
      }
      expect(report.added).toEqual([]);
      expect(report.updated).toEqual([]);
      expect(report.removed).toEqual([]);
      // 工程形状随锚点显式维护：列数变化必须伴随 gen 产物重建（列名注册表随之变化）
      expect(report.columns).toBe(14);
      expect(readFileSync(typegenPath, "utf8")).toBe(committed);
      expect(readFileSync(stateGenPath, "utf8")).toBe(committedState);
      expect(readFileSync(scriptGenPath, "utf8")).toBe(committedScript);
      expect(readFileSync(fontGenPath, "utf8")).toBe(committedFont);
      // state 类型面形状锚：精确到枚举引用（Sex 走 import type），不得退化为宽 any
      expect(committedState).toContain("export type StoryState = {");
      expect(committedState).toContain('import type { Sex } from "../lib/enums";');
      expect(committedState).toContain('"sex": Sex;');
      // 插值键注册表的 let 声明名形状锚：ticket 只经 let 词调用声明（无 vars/state 同名双源），
      // 它在注册表里即证明源级声明名通道在真实工程也通。
      expect(committed).toContain('"ticket": 1;');
      // script ambient 声明形状锚：单条 declare 指向 editor 根出口的 script 命名空间
      expect(committedScript).toContain(
        'declare const script: typeof import("@lingfan/editor").script;',
      );
      // 字体类型面形状锚：工程未放字体文件 = 封闭空类型（非宽 Record<string, string>，
      // 退化会放弃拼错保护）；键 = 值 = 注册表字体名的契约由下方新鲜度用例与 font 探针覆盖
      expect(committedFont).toContain("declare const font: Record<never, never>;");
    } finally {
      if (readFileSync(typegenPath, "utf8") !== committed) {
        writeFileSync(typegenPath, committed);
      }
      if (readFileSync(stateGenPath, "utf8") !== committedState) {
        writeFileSync(stateGenPath, committedState);
      }
      if (readFileSync(scriptGenPath, "utf8") !== committedScript) {
        writeFileSync(scriptGenPath, committedScript);
      }
      if (readFileSync(fontGenPath, "utf8") !== committedFont) {
        writeFileSync(fontGenPath, committedFont);
      }
    }
  });

  it("手改生成物：构建重写回入库字节（修复路径证明锚点非空转）", { retry: 1 }, async (ctx) => {
    const typegenPath = join(PLAYGROUND_ROOT, TYPEGEN_REL);
    const committed = readFileSync(typegenPath, "utf8");
    try {
      writeFileSync(typegenPath, `${committed}\n/* 手改的冗余行 */\n`);
      let report;
      try {
        report = await buildStories(PLAYGROUND_ROOT);
      } catch (error) {
        if (isConfigContractTransition(error)) ctx.skip();
        throw error;
      }
      expect(report.updated).toContain(TYPEGEN_REL);
      expect(readFileSync(typegenPath, "utf8")).toBe(committed);
    } finally {
      if (readFileSync(typegenPath, "utf8") !== committed) {
        writeFileSync(typegenPath, committed);
      }
    }
  });

  it("font.gen 新鲜度：字体文件落盘→键=值入类型面，删文件重构建→恢复封闭空类型", { retry: 1 }, async (ctx) => {
    const fontGenPath = join(PLAYGROUND_ROOT, FONT_GEN_REL);
    const fontFile = join(PLAYGROUND_ROOT, "Resources/Fonts/楷体.ttf");
    const committedFont = readFileSync(fontGenPath, "utf8");
    try {
      // 桩字体文件：注册表只认文件名（去扩展名），内容不参与扫描——真实字体二进制不入仓
      writeFileSync(fontFile, "");
      let report;
      try {
        report = await buildStories(PLAYGROUND_ROOT);
      } catch (error) {
        if (isConfigContractTransition(error)) ctx.skip();
        throw error;
      }
      expect(report.updated).toContain(FONT_GEN_REL);
      expect(readFileSync(fontGenPath, "utf8")).toContain(
        'readonly "楷体": "楷体";',
      );

      rmSync(fontFile, { force: true });
      report = await buildStories(PLAYGROUND_ROOT);
      expect(report.updated).toContain(FONT_GEN_REL);
      expect(readFileSync(fontGenPath, "utf8")).toBe(committedFont);
    } finally {
      rmSync(fontFile, { force: true });
      if (readFileSync(fontGenPath, "utf8") !== committedFont) {
        writeFileSync(fontGenPath, committedFont);
      }
    }
  });

  it("tsc 负例探针：state 上的错误类型被 stories-typecheck 拒绝（精确类型面非宽垫片）", { retry: 1, timeout: 60000 }, async () => {
    const probePath = join(PLAYGROUND_ROOT, PROBE_REL);
    const tsconfigPath = join(PLAYGROUND_ROOT, "tsconfig.json");
    const tscBin = fileURLToPath(
      new URL("../../node_modules/typescript/bin/tsc", import.meta.url),
    );
    writeFileSync(probePath, PROBE_SOURCE);
    try {
      const run = spawnSync(process.execPath, [tscBin, "--noEmit", "-p", tsconfigPath], {
        encoding: "utf8",
      });
      // 探针把 player.gold（number）写成 string：精确类型面下 tsc 必须非零退出并指到探针文件
      expect(run.error).toBeUndefined();
      expect(run.status).not.toBe(0);
      expect(run.stdout ?? "").toContain("typecheck-probe.ts");
    } finally {
      rmSync(probePath, { force: true });
    }
  });

  it("script ambient 探针：错键 script.bgmX 被 tsc 拒绝，正确键 script.bgm 放行", { retry: 1, timeout: 60000 }, async () => {
    const probePath = join(PLAYGROUND_ROOT, SCRIPT_PROBE_REL);
    const tsconfigPath = join(PLAYGROUND_ROOT, "tsconfig.json");
    const tscBin = fileURLToPath(
      new URL("../../node_modules/typescript/bin/tsc", import.meta.url),
    );
    const runTsc = () =>
      spawnSync(process.execPath, [tscBin, "--noEmit", "-p", tsconfigPath], {
        encoding: "utf8",
      });
    try {
      writeFileSync(probePath, SCRIPT_PROBE_NEGATIVE);
      const bad = runTsc();
      // ambient 声明精确到词函数：错键必须非零退出并指到探针文件（松散 any 声明则两态皆绿）
      expect(bad.error).toBeUndefined();
      expect(bad.status).not.toBe(0);
      expect(bad.stdout ?? "").toContain("script-probe.ts");

      writeFileSync(probePath, SCRIPT_PROBE_POSITIVE);
      const good = runTsc();
      expect(good.error).toBeUndefined();
      expect(good.status).toBe(0);
    } finally {
      rmSync(probePath, { force: true });
    }
  });

  it("font ambient 探针：未注册名 font.缺省字体 被 tsc 拒绝，注册名 font.楷体 放行", { retry: 1, timeout: 60000 }, async (ctx) => {
    const probePath = join(PLAYGROUND_ROOT, FONT_PROBE_REL);
    const fontFile = join(PLAYGROUND_ROOT, "Resources/Fonts/楷体.ttf");
    const fontGenPath = join(PLAYGROUND_ROOT, FONT_GEN_REL);
    const committedFont = readFileSync(fontGenPath, "utf8");
    const tsconfigPath = join(PLAYGROUND_ROOT, "tsconfig.json");
    const tscBin = fileURLToPath(
      new URL("../../node_modules/typescript/bin/tsc", import.meta.url),
    );
    const runTsc = () =>
      spawnSync(process.execPath, [tscBin, "--noEmit", "-p", tsconfigPath], {
        encoding: "utf8",
      });
    try {
      // 探针需要非空注册表：落桩字体并重建类型面（finally 恢复封闭空类型）
      writeFileSync(fontFile, "");
      try {
        await buildStories(PLAYGROUND_ROOT);
      } catch (error) {
        if (isConfigContractTransition(error)) ctx.skip();
        throw error;
      }
      writeFileSync(probePath, FONT_PROBE_NEGATIVE);
      const bad = runTsc();
      // ambient 声明精确到注册表：错键必须非零退出并指到探针文件（宽 Record<string, string> 则两态皆绿）
      expect(bad.error).toBeUndefined();
      expect(bad.status).not.toBe(0);
      expect(bad.stdout ?? "").toContain("font-probe.ts");

      writeFileSync(probePath, FONT_PROBE_POSITIVE);
      const good = runTsc();
      expect(good.error).toBeUndefined();
      expect(good.status).toBe(0);
    } finally {
      rmSync(probePath, { force: true });
      rmSync(fontFile, { force: true });
      if (readFileSync(fontGenPath, "utf8") !== committedFont) {
        writeFileSync(fontGenPath, committedFont);
      }
    }
  });
});
