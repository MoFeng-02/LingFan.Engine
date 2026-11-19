/**
 * 真实工程回归锚点：apps/playground（唯一全功能真实工程）整链构建 vs 入库产物。
 *
 * 锚定口径：
 * - 真实工程全链构建（源发现 → 编译 → 往返自检 → 差量写盘）必须零差量——入库的
 *   `src/gen/stories.gen.d.ts` 与当轮计算产物逐字节一致。链上任一环改变输出
 *   （编译器、typegen、扩展装载、源文件），本锚点立即红，倒逼产物随源显式重建。
 * - 判别性落点：`journal.flag` 只在变量清单（config.vars，换道前是 defineVars 清单）
 *   出现（state/let/插值均无此键），
 *   它进注册表的唯一通道是编排层的 defineKeys 源——该源被撤时本锚点必红
 *   （最小工程上的同一判别见 typegen.test.ts）。
 * - state 类型面（state.gen.d.ts）与 stories.gen.d.ts 同口径锚定：入库字节与当轮计算
 *   产物逐字节一致，且形状必须仍锚在「从 config define 树生成的精确类型」上——
 *   枚举走 import type 引用（`Sex`），不回退内联联合；类型面退化为宽 any 时本锚点红。
 * - script 命名空间 ambient 声明（script.gen.d.ts）同口径锚定：内容恒定，锚住
 *   `declare const script: typeof import("@lingfan-engine/editor").script;` 一行——声明面
 *   换形（如改成运行时注入）时本锚点红。
 * - 字体类型面（font.gen.d.ts）同口径锚定：工程未声明字体时锚住封闭空类型
 *   `Record<never, never>`——退化成开放索引签名（放弃拼错保护）时本锚点红。
 * - tsc 负例探针：对真实工程临时注入一个类型错误的章节模块，`tsc --noEmit` 必须拒绝——
 *   证明 gen/state.gen.d.ts 提供的是精确类型面而非松散类型（宽 any 垫片探针不红）。
 * - script ambient 探针：错键 `script.bgmX` 被 ambient 类型面拒绝、正确键 `script.bgm`
 *   放行——证明声明面精确到词函数（松散 any 声明两者皆绿）。
 * - 注册表收窄探针：列名/插值键/UI 名/场景名/守卫名五处登记处各取一个未注册名，
 *   负例必须被拒、正例逐行抑制后必须全绿——证明 declare module 合并真实生效
 *   （合并静默失效时 Known* 回退 string，负例空绿、正例抑制指令未使用反而红）。
 * - font.gen 新鲜度：字体文件落盘 → 键=值入类型面；删文件重构建 → 恢复封闭空类型
 *   （注册表跟随构建，不是一次性快照）。font ambient 探针同样两态：错键
 *   `font.缺省字体` 拒、注册名 `font.楷体` 过（两例都自置桩字体夹具，finally 全清，
 *   入库态保持空注册表）。
 * - UI 注册表生成物（ui_register.g.ts）同口径锚定：入库字节与当轮计算产物逐字节一致，
 *   且三段导出都在——宿主「名字→组件」表、故事源具名句柄、`UiNameRegistry` 类型面。
 * - UI 句柄与名字收窄：由故事源自己的类型断言守住（`src/Stories.src/lib/ui-probe.ts`：
 *   句柄形状与注册名两态，跑在 `stories-typecheck`）——本文件不另起临时探针，
 *   避免为同一件事再加一处「写-删工程文件」的窗口。
 * - 手改生成物的修复路径也锚定：作者误改 gen 文件后，构建必须重写回正确字节——
 *   同时证明逐字节一致不是「构建没算」的空转绿。
 *
 * config 化过渡守卫：config 化之后、Stories.src 迁移完成之前，真实工程
 * 仍是旧 config 契约，构建必然以「缺少 folders 导出」fail-closed——两例此时 skip（确定性
 * 契约错误，不是环境竞态）；Stories.src 迁移完成后错误消失、守卫自动失效，届时可删除 isConfigContractTransition。
 *
 * 写盘机制细节（差量判定、陈旧清理、report 计数）由 build-pipeline.test.ts 在最小工程
 * 覆盖；本文件不重复，只锚真实工程的整链终态。
 *
 * 并行隔离（临时副本）：本文件是全仓唯一对真实工程做「读-改-写」的测试。所有构建与
 * 探针都落在真实工程的**临时副本**上——真实工程树全程只读（锚定的入库字节从这里取），
 * 并行读真实工程的用例（story-source-project 的就近工程比对、build-pipeline 的重提取）
 * 看到的永远是稳定的入库态，不再有「别人正在落探针」的 I/O 竞态窗口。副本放在 tests/
 * 下，node_modules 经仓根解析（与最小工程同口径）；只拷构建输入（src / extensions /
 * Resources 的 Lang·Stories·project.json·空 Fonts 目录），不拷媒体二进制（Audio/Images/
 * Video）与私有字体——它们不是类型面构建的输入。每例独立副本，afterEach 整体清除，
 * 不在工作区留下工具状态。retry 1 只吸收重载下的 CPU 争用超时（I/O 竞态已由隔离消除），
 * 真回归两次必红，不会被吞。tsc 探针显式抬到 60s 时限（全量并行下单次 tsc 可能远超缺省）。
 */
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildStories } from "@lingfan-engine/stories-build";

const PLAYGROUND_ROOT = fileURLToPath(
  new URL("../../apps/playground/", import.meta.url),
);
/** 临时副本根（tests/ 下，node_modules 经仓根解析）；每例一个独立子目录。 */
const TEMP_BASE = fileURLToPath(
  new URL("./.tmp-playground-anchor/", import.meta.url),
);
/** 仓根 tsconfig（绝对路径）：副本的宿主 tsconfig 经它继承 compilerOptions/paths。 */
const REPO_TSCONFIG = fileURLToPath(
  new URL("../../tsconfig.json", import.meta.url),
);
let root: string;
let tempSeq = 0;

/** 从真实工程拷一份构建输入到副本（真实树只读，锚定字节也从真实树取）。 */
function copyInput(rel: string): void {
  cpSync(join(PLAYGROUND_ROOT, rel), join(root, rel), { recursive: true });
}

beforeEach(() => {
  root = join(TEMP_BASE, `case-${tempSeq++}`);
  mkdirSync(root, { recursive: true });
  copyInput("src");
  copyInput("extensions");
  // 宿主 tsconfig：真实工程的 extends 是相对仓根的（../../tsconfig.json），拷进副本会
  // 指向不存在的路径（扩展 .ts 经 Node 转换时按文件位置向上找 tsconfig，继承链断则
  // TSCONFIG_ERROR）。这里生成一份等价配置，extends 用仓根绝对路径——compilerOptions
  // 与 paths 仍由仓根 tsconfig 提供（paths 相对声明者解析，落点不变），include/exclude
  // 与真实工程逐字一致。
  writeFileSync(
    join(root, "tsconfig.json"),
    `${JSON.stringify(
      {
        extends: REPO_TSCONFIG,
        include: ["src/**/*.ts", "src/**/*.vue"],
        exclude: ["src/Stories.src/**"],
      },
      null,
      2,
    )}\n`,
  );
  copyInput("tsconfig.stories.json");
  copyInput("package.json");
  // 字体注册表只扫 Fonts 顶层文件名：空目录 = 空注册表（与入库的封闭空类型一致），
  // 私有字体子目录与媒体二进制都不是构建输入，不拷。
  mkdirSync(join(root, "Resources/Fonts"), { recursive: true });
  copyInput("Resources/Lang");
  copyInput("Resources/Stories");
  copyInput("Resources/project.json");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  rmSync(TEMP_BASE, { recursive: true, force: true });
});
/** report 里的逻辑路径是 posix 相对路径（与源根命名空间一致），保持正斜杠字面量 */
const TYPEGEN_REL = "src/gen/stories.gen.d.ts";
const STATE_GEN_REL = "src/gen/state.gen.d.ts";
const SCRIPT_GEN_REL = "src/gen/script.gen.d.ts";
const FONT_GEN_REL = "src/gen/font.gen.d.ts";
const UI_GEN_REL = "src/gen/ui_register.g.ts";
/** tsc 负例探针：类型错误章节模块（finally 删除，不带 default 导出、不进故事发现） */
const PROBE_REL = "src/Stories.src/chapter1/typecheck-probe.ts";
const PROBE_SOURCE = [
  "/* 临时探针：tsc --noEmit 必须拒绝 state 上的错误类型（测试 finally 删除本文件） */",
  "export function typecheckProbe(): void {",
  '  state.player.gold = "x";',
  "}",
  "",
].join("\n");
/** script ambient 探针：错键/正键两态（finally 删除；ambient 直呼不导入，走全局声明） */
const SCRIPT_PROBE_REL = "src/Stories.src/chapter1/script-probe.ts";
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
const FONT_PROBE_REL = "src/Stories.src/chapter1/font-probe.ts";
/**
 * 注册表收窄探针：五处登记处（列名/插值键/UI 名/场景名/守卫名）各为一个未注册名。
 * 负例不带抑制指令——收窄生效时 tsc 必须拒绝；正例逐行抑制——五条指令必须全部被
 * 真实收窄错误消费（合并静默失效时 Known* 回退 string，负例空绿、正例指令未使用红）。
 */
const REGISTRY_PROBE_REL = "src/Stories.src/chapter1/registry-probe.ts";
const REGISTRY_PROBE_NEGATIVE = [
  "/* 临时探针：五处注册表的未注册名必须被拒绝（测试 finally 删除本文件） */",
  "export function registryProbeNegative(): void {",
  '  script.jump("no-such-column");',
  '  script.say("{no_such_key}");',
  '  script.mount("no-such-ui", true);',
  '  script.navigate("start", "no-such-scene");',
  '  script.guard("no-such-guard");',
  "}",
  "",
].join("\n");
const REGISTRY_PROBE_POSITIVE = [
  "/* 临时探针：五条收窄错误逐行抑制，指令必须全部被消费（测试 finally 删除本文件） */",
  "export function registryProbePositive(): void {",
  "  // @ts-expect-error 未注册列名",
  '  script.jump("no-such-column");',
  "  // @ts-expect-error 未注册插值键",
  '  script.say("{no_such_key}");',
  "  // @ts-expect-error 未注册 UI 名",
  '  script.mount("no-such-ui", true);',
  "  // @ts-expect-error 未注册场景名",
  '  script.navigate("start", "no-such-scene");',
  "  // @ts-expect-error 未注册守卫名",
  '  script.guard("no-such-guard");',
  "}",
  "",
].join("\n");
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
/**
 * vue-tsc 探针：故事源工程在**组件编译器**下必须零错。
 *
 * 纯 tsc 看故事源是绿的（组件编译器没有 SFC 解析能力，`*.vue` 默认导入落到
 * authoring 声明的 `UiHandle` 通配上）。但编辑器（Volar）与 `vue-tsc` 会把 `*.vue`
 * 解析成真实组件类型，优先级高于 ambient 通配，于是 `mount(句柄)` 变成
 * 「DefineComponent 不能赋给 UiHandle」——用户在编辑器里红，仓库门禁却绿。
 *
 * 判据分两态：
 * - 正态 = 当前工程零错（句柄从生成物具名导出取，绕开组件解析）；
 * - 反态 = 注入一条 `*.vue` 默认导入的探针，vue-tsc 必须拒绝它。
 * 只跑正态会假绿（vue-tsc 没装好或没解析到组件时同样零错），所以必须有反态兜住判别力。
 */
const VUE_TSC_PROBE_REL = "src/Stories.src/chapter1/vue-tsc-probe.ts";
const VUE_TSC_PROBE_SOURCE = [
  "/* 临时探针：*.vue 默认导入必须被 vue-tsc 拒绝（测试 finally 删除本文件） */",
  'import hub from "../../ui/hub/hub.vue";',
  'import { mount } from "@lingfan-engine/editor";',
  "export function vueTscProbe(): void {",
  '  mount(hub, true, { label: "x" });',
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

/**
 * 落桩字体文件：字体目录不进版本库（真实字体二进制不入仓，且该目录下有本机私有字体子目录），
 * 干净检出里根本没有 Fonts 目录——写文件前必须先建目录，否则 ENOENT 直接红而不是断言红。
 */
function writeStubFont(fontFile: string): void {
  mkdirSync(dirname(fontFile), { recursive: true });
  writeFileSync(fontFile, "");
}

describe("真实工程回归锚点（apps/playground 整链）", () => {
  it(
    "全链构建零差量：入库类型面产物与当轮计算产物逐字节一致",
    { retry: 1 },
    async (ctx) => {
      // 锚定字节取自真实工程（只读）；构建落在临时副本上，真实树不被改写。
      const committed = readFileSync(
        join(PLAYGROUND_ROOT, TYPEGEN_REL),
        "utf8",
      );
      const committedState = readFileSync(
        join(PLAYGROUND_ROOT, STATE_GEN_REL),
        "utf8",
      );
      const committedScript = readFileSync(
        join(PLAYGROUND_ROOT, SCRIPT_GEN_REL),
        "utf8",
      );
      const committedFont = readFileSync(
        join(PLAYGROUND_ROOT, FONT_GEN_REL),
        "utf8",
      );
      const committedUi = readFileSync(
        join(PLAYGROUND_ROOT, UI_GEN_REL),
        "utf8",
      );
      let report;
      try {
        report = await buildStories(root);
      } catch (error) {
        if (isConfigContractTransition(error)) ctx.skip();
        throw error;
      }
      expect(report.added).toEqual([]);
      expect(report.updated).toEqual([]);
      expect(report.removed).toEqual([]);
      // 工程形状随锚点显式维护：列数变化必须伴随 gen 产物重建（列名注册表随之变化）
      // 20 = 20 个 default 导出列。`chapter1/start.ts` 里的 `export function goToLabel`
      // 当前没有被 `jump`/`navigate` 字面量引用（那处调用被注释掉了），label 通道
      // 不替它产列；要放回 21 就先恢复那处引用。
      expect(report.columns).toBe(20);
      expect(readFileSync(join(root, TYPEGEN_REL), "utf8")).toBe(committed);
      expect(readFileSync(join(root, STATE_GEN_REL), "utf8")).toBe(
        committedState,
      );
      expect(readFileSync(join(root, SCRIPT_GEN_REL), "utf8")).toBe(
        committedScript,
      );
      expect(readFileSync(join(root, FONT_GEN_REL), "utf8")).toBe(
        committedFont,
      );
      expect(readFileSync(join(root, UI_GEN_REL), "utf8")).toBe(committedUi);
      // state 类型面形状锚：精确到枚举引用（Sex 走 import type），不得退化为宽 any
      expect(committedState).toContain("export type StoryState = {");
      expect(committedState).toContain(
        'import type { Sex } from "../Stories.src/lib/enums";',
      );
      expect(committedState).toContain('"sex": Sex;');
      // 插值键注册表的 let 声明名形状锚：ticket 只经 let 词调用声明（无 vars/state 同名双源），
      // 它在注册表里即证明源级声明名通道在真实工程也通。
      expect(committed).toContain('"ticket": 1;');
      // script ambient 声明形状锚：单条 declare 指向 editor 根出口的 script 命名空间
      expect(committedScript).toContain(
        'declare const script: typeof import("@lingfan-engine/editor").script;',
      );
      // 字体类型面形状锚：工程未放字体文件 = 封闭空类型（非宽 Record<string, string>，
      // 退化会放弃拼错保护）；键 = 值 = 注册表字体名的契约由下方新鲜度用例与 font 探针覆盖
      expect(committedFont).toContain(
        "declare const font: Record<never, never>;",
      );
      // UI 注册表三段导出：宿主查表用的「名字→组件」、故事源具名句柄、类型面登记处。
      // 任一段被删都意味着有消费方拿不到入口——宿主挂不上、作者写不出句柄、
      // 拼错名字不再被类型拦。
      expect(committedUi).toContain('"hub": hubView,');
      expect(committedUi).toContain(
        'export const hub: UiHandle<"hub"> = { face: "uis", name: "hub" };',
      );
      expect(committedUi).toContain('"hub": 1;');
    },
  );

  it(
    "手改生成物：构建重写回入库字节（修复路径证明锚点非空转）",
    { retry: 1 },
    async (ctx) => {
      const committed = readFileSync(
        join(PLAYGROUND_ROOT, TYPEGEN_REL),
        "utf8",
      );
      const typegenPath = join(root, TYPEGEN_REL);
      writeFileSync(typegenPath, `${committed}\n/* 手改的冗余行 */\n`);
      let report;
      try {
        report = await buildStories(root);
      } catch (error) {
        if (isConfigContractTransition(error)) ctx.skip();
        throw error;
      }
      expect(report.updated).toContain(TYPEGEN_REL);
      expect(readFileSync(typegenPath, "utf8")).toBe(committed);
    },
  );

  it(
    "font.gen 新鲜度：字体文件落盘→键=值入类型面，删文件重构建→恢复封闭空类型",
    { retry: 1 },
    async (ctx) => {
      const fontGenPath = join(root, FONT_GEN_REL);
      const fontFile = join(root, "Resources/Fonts/楷体.ttf");
      const committedFont = readFileSync(
        join(PLAYGROUND_ROOT, FONT_GEN_REL),
        "utf8",
      );
      // 桩字体文件：注册表只认文件名（去扩展名），内容不参与扫描——真实字体二进制不入仓
      writeStubFont(fontFile);
      let report;
      try {
        report = await buildStories(root);
      } catch (error) {
        if (isConfigContractTransition(error)) ctx.skip();
        throw error;
      }
      expect(report.updated).toContain(FONT_GEN_REL);
      expect(readFileSync(fontGenPath, "utf8")).toContain(
        'readonly "楷体": "楷体";',
      );

      rmSync(fontFile, { force: true });
      report = await buildStories(root);
      expect(report.updated).toContain(FONT_GEN_REL);
      expect(readFileSync(fontGenPath, "utf8")).toBe(committedFont);
    },
  );

  it(
    "tsc 负例探针：state 上的错误类型被 stories-typecheck 拒绝（精确类型面非宽垫片）",
    { retry: 1, timeout: 60000 },
    async () => {
      const probePath = join(root, PROBE_REL);
      const tsconfigPath = join(root, "tsconfig.stories.json");
      const tscBin = fileURLToPath(
        new URL("../../node_modules/typescript/bin/tsc", import.meta.url),
      );
      writeFileSync(probePath, PROBE_SOURCE);
      try {
        const run = spawnSync(
          process.execPath,
          [tscBin, "--noEmit", "-p", tsconfigPath],
          {
            encoding: "utf8",
          },
        );
        // 探针把 player.gold（number）写成 string：精确类型面下 tsc 必须非零退出并指到探针文件
        expect(run.error).toBeUndefined();
        expect(run.status).not.toBe(0);
        expect(run.stdout ?? "").toContain("typecheck-probe.ts");
      } finally {
        rmSync(probePath, { force: true });
      }
    },
  );

  it(
    "script ambient 探针：错键 script.bgmX 被 tsc 拒绝，正确键 script.bgm 放行",
    { retry: 1, timeout: 60000 },
    async () => {
      const probePath = join(root, SCRIPT_PROBE_REL);
      const tsconfigPath = join(root, "tsconfig.stories.json");
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
    },
  );

  it(
    "注册表收窄探针：五处未注册名被拒，逐行抑制后全绿（合并静默失效则两态反转）",
    { retry: 1, timeout: 60000 },
    async () => {
      const probePath = join(root, REGISTRY_PROBE_REL);
      const tsconfigPath = join(root, "tsconfig.stories.json");
      const tscBin = fileURLToPath(
        new URL("../../node_modules/typescript/bin/tsc", import.meta.url),
      );
      const runTsc = () =>
        spawnSync(process.execPath, [tscBin, "--noEmit", "-p", tsconfigPath], {
          encoding: "utf8",
        });
      try {
        writeFileSync(probePath, REGISTRY_PROBE_NEGATIVE);
        const bad = runTsc();
        // 收窄生效：五个未注册名必须非零退出并指到探针文件（Known* 回退 string 则空绿）
        expect(bad.error).toBeUndefined();
        expect(bad.status).not.toBe(0);
        expect(bad.stdout ?? "").toContain("registry-probe.ts");

        writeFileSync(probePath, REGISTRY_PROBE_POSITIVE);
        const good = runTsc();
        // 五条抑制指令必须全部被真实收窄错误消费；合并失效时指令未使用，tsc 反而红
        expect(good.error).toBeUndefined();
        expect(good.status).toBe(0);
      } finally {
        rmSync(probePath, { force: true });
      }
    },
  );

  it(
    "font ambient 探针：未注册名 font.缺省字体 被 tsc 拒绝，注册名 font.楷体 放行",
    { retry: 1, timeout: 60000 },
    async (ctx) => {
      const probePath = join(root, FONT_PROBE_REL);
      const fontFile = join(root, "Resources/Fonts/楷体.ttf");
      const tsconfigPath = join(root, "tsconfig.stories.json");
      const tscBin = fileURLToPath(
        new URL("../../node_modules/typescript/bin/tsc", import.meta.url),
      );
      const runTsc = () =>
        spawnSync(process.execPath, [tscBin, "--noEmit", "-p", tsconfigPath], {
          encoding: "utf8",
        });
      try {
        // 探针需要非空注册表：落桩字体并重建类型面（副本用完即清，入库态不受影响）
        writeStubFont(fontFile);
        try {
          await buildStories(root);
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
      }
    },
  );

  it(
    "vue-tsc 探针：故事源工程在组件编译器下零错，*.vue 默认导入被拒绝",
    { retry: 1, timeout: 60000 },
    async () => {
      const probePath = join(root, VUE_TSC_PROBE_REL);
      const tsconfigPath = join(root, "tsconfig.stories.json");
      const vueTscBin = fileURLToPath(
        new URL("../../node_modules/vue-tsc/bin/vue-tsc.js", import.meta.url),
      );
      const runVueTsc = () =>
        spawnSync(
          process.execPath,
          [vueTscBin, "--noEmit", "-p", tsconfigPath],
          { encoding: "utf8" },
        );
      try {
        // 正态：当前故事源工程在 vue-tsc 下零错（句柄走生成物具名导出）
        const clean = runVueTsc();
        expect(clean.error).toBeUndefined();
        expect(
          clean.stdout ?? "",
          "故事源工程在 vue-tsc 下必须零错：编辑器用的就是这套组件解析",
        ).toBe("");

        // 反态：注入 *.vue 默认导入，vue-tsc 必须拒绝——判别力兜底，防「vue-tsc 没生效」假绿
        writeFileSync(probePath, VUE_TSC_PROBE_SOURCE);
        const bad = runVueTsc();
        expect(bad.error).toBeUndefined();
        expect(bad.status).not.toBe(0);
        expect(bad.stdout ?? "").toContain("vue-tsc-probe.ts");
      } finally {
        rmSync(probePath, { force: true });
      }
    },
  );
});
