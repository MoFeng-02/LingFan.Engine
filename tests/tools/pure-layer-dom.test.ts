/**
 * 纯层 DOM 体检：`packages/ui/src`（除 `src/dom/`）与 `packages/shell/src` 是
 * **渲染描述树与宿主装配语义**，二者都必须在任何平台之外成立——否则小程序与未来
 * AOT 拿不到可用实现。DOM 只允许出现在 `packages/ui/src/dom/`（DOM 物化器与覆盖层
 * 表面），这条边界在 `eslint.config.js` 的 `lingfan/pure-layer-no-dom` 块里是机器
 * 判据，在这里是**第二道体检**。
 *
 * 为什么两道都要：eslint 的 `no-restricted-globals` 只拦**值引用**，类型注解
 * （`foo: HTMLElement` 里的 `HTMLElement` 是 `TSTypeReference`）拦不住（`06` §2.2）；
 * 而体检测试靠词法扫描，两种位置都能咬。
 *
 * 反过来，eslint 能拦 `const w = window;` 这类裸值引用，本文件的 `window` 判据
 * 却必须收窄成取值形态（见 `DOM_VALUE_SYMBOLS` 注释）——两道判据互补，谁都不冗余。
 *
 * 词法判据前先剥掉注释与字符串，否则文档注释里出现的 `document` 会误报
 * （`packages/ui/src/host/index.ts` 等处就有这类说明性文字）。
 */
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import eslintConfigSource from "../../eslint.config.js?raw";

/**
 * ui 包内唯一允许出现 DOM 的目录。
 * glob 侧用负向模式排除，扫描侧再兜一次——两道都留，因为
 * `import.meta.glob` 的负向模式一旦被后人改写，静默放宽比直接报错更难发现。
 */
const DOM_DIR = "packages/ui/src/dom/";

const uiSources = import.meta.glob(
  ["../../packages/ui/src/**/*.ts", "!../../packages/ui/src/dom/**"],
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

const shellSources = import.meta.glob("../../packages/shell/src/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/**
 * 剥离器：把注释与字符串替换成空格，只留代码骨架。
 *
 * **单趟交替而不是三趟串行**（`06` §3.1 给的是「块注释 → 行注释 → 字符串」三段）。
 * 三段串行有个真实的坑：字符串里出现 `//`（URL、除号后紧跟斜杠）时，行注释那一趟
 * 会把字符串的后半截连同收尾引号一起吃掉，下一趟就从一个不成对的引号开始配对，
 * 可能把紧随其后的真代码（含 `document`）整段吞成「字符串」——闸门于是静默失效。
 * 单趟交替的每个分支都从当前位置整体匹配掉，不存在跨趟的中间态。
 * 本文件的自证用例 `字符串里的 /` 不吃掉其后的真代码` 专门钉这条。
 *
 * 正则字面量不单独处理：纯层现存的 `/.../ ` 前驱都是运算符，剥离器不认也不会
 * 把其中的词误判成代码（正则内容里出现 DOM 词的形态在纯层不存在）。
 */
const STRIPPABLE =
  /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g;

function stripToCodeSkeleton(source: string): string {
  return source.replace(STRIPPABLE, " ");
}

/**
 * DOM **值**引用词表（对应 eslint 的 `no-restricted-globals`）。
 *
 * `window` 只认**取值形态**（`window.` / `window[`）：`packages/ui/src/element/
 * renderers/register.ts` 里 `window:` 是元素类型表的**键名**（`window` 是本仓的
 * 叙事元素类型），裸词判据会把它误报成 DOM 触点。裸值形态（`useWindow(window)`）
 * 由 eslint 那道拦——两道判据覆盖不同形态，这是分工不是缺口。
 * `cancelAnimationFrame` 与 `requestAnimationFrame` 同属帧源，一并列。
 */
const DOM_VALUE_SYMBOLS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: "document", re: /\bdocument\b/ },
  { label: "window.<attr>", re: /\bwindow\s*[.[]/ },
  { label: "ownerDocument", re: /\bownerDocument\b/ },
  { label: "defaultView", re: /\bdefaultView\b/ },
  { label: "navigator", re: /\bnavigator\b/ },
  { label: "localStorage", re: /\blocalStorage\b/ },
  { label: "sessionStorage", re: /\bsessionStorage\b/ },
  { label: "requestAnimationFrame", re: /\brequestAnimationFrame\b/ },
  { label: "cancelAnimationFrame", re: /\bcancelAnimationFrame\b/ },
  { label: "ResizeObserver", re: /\bResizeObserver\b/ },
  { label: "matchMedia", re: /\bmatchMedia\b/ },
  { label: "createElement", re: /\bcreateElement\b/ },
];

/**
 * DOM **类型**引用词表（`no-restricted-globals` 拦不到的那一半，`06` §2.2）。
 *
 * `\bElement\b` 不会顺带命中 `HTMLElement`：`HTML` 与 `Element` 之间两字母相邻，
 * 没有词边界，故各类型名之间不会互相误报。
 */
const DOM_TYPE_SYMBOLS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: "HTMLElement", re: /\bHTMLElement\b/ },
  { label: "HTMLDivElement", re: /\bHTMLDivElement\b/ },
  { label: "HTMLImageElement", re: /\bHTMLImageElement\b/ },
  { label: "HTMLVideoElement", re: /\bHTMLVideoElement\b/ },
  // `[A-Za-z]+` 要求 HTML 与 Element 之间至少一个字母，故 `HTMLElement` 不会被
  // 这一条双命中（`HTML` 之后若只剩 `Element`，`[A-Za-z]+` 吃掉它就再没有
  // `Element` 可配），各类型名之间也就不互相误报。
  { label: "HTML*Element 泛型族", re: /\bHTML[A-Za-z]+Element\b/ },
  { label: "SVGElement", re: /\bSVGElement\b/ },
  { label: "Element", re: /\bElement\b/ },
  { label: "Node", re: /\bNode\b/ },
];

/**
 * 允许清单：将来确需例外时必须列在这里，**带理由**，并显式写出路径与符号。
 * 空清单是当前事实（纯层零 DOM 触点），也是本次治根要保住的状态——
 * `it("允许清单为空")` 会在有人偷偷加例外时变红，强制把理由摆到台面上。
 */
const ALLOWLIST: ReadonlyArray<{
  path: string;
  symbol: string;
  reason: string;
}> = [];

/** glob 键 → 仓库相对路径 */
function rel(key: string): string {
  return key.replace(/^\.\.\/\.\.\//, "").replace(/\\/g, "/");
}

/** 该源码骨架里命中的符号名（去重，无命中返回空数组） */
function domHits(raw: string): string[] {
  const skeleton = stripToCodeSkeleton(raw);
  const symbols = [...DOM_VALUE_SYMBOLS, ...DOM_TYPE_SYMBOLS];
  const hits = symbols.filter((s) => s.re.test(skeleton)).map((s) => s.label);
  return [...new Set(hits)];
}

/** 命中是否被允许清单豁免（路径 + 符号同时匹配才算） */
function allowlisted(path: string, symbol: string): boolean {
  return ALLOWLIST.some((e) => e.path === path && e.symbol === symbol);
}

/** 扫描面：ui（除 dom/）+ shell 的全部源码骨架 */
const scannedFiles: ReadonlyArray<{ path: string; raw: string }> = [
  ...Object.entries(uiSources).map(([k, v]) => ({ path: rel(k), raw: v })),
  ...Object.entries(shellSources).map(([k, v]) => ({ path: rel(k), raw: v })),
];

describe("纯层 DOM 体检（源级扫描）", () => {
  it("扫描面非空（glob 失配时立刻失败，不许空转通过）", () => {
    expect(Object.keys(uiSources).length).toBeGreaterThanOrEqual(50);
    expect(Object.keys(shellSources).length).toBeGreaterThanOrEqual(10);
    // 负向模式生效：dom/ 目录确实不在扫描面里（它在磁盘上有 4 个文件）
    expect(scannedFiles.filter((f) => f.path.startsWith(DOM_DIR))).toEqual([]);
  });

  it("允许清单为空（加例外必须显式写理由，不许静默放宽）", () => {
    expect(ALLOWLIST).toEqual([]);
    expect(ALLOWLIST.length).toBe(0);
  });

  it("剥离器自证：能咬 document，注释与字符串里的不算", () => {
    // 会咬：真代码里的值引用与类型引用
    expect(domHits("const a = document.body;")).toEqual(["document"]);
    expect(domHits("const c: HTMLElement = el;")).toEqual(["HTMLElement"]);
    expect(
      domHits("export function f() { return window.innerWidth; }"),
    ).toEqual(["window.<attr>"]);
    // 不误报：注释（块注释与行注释）
    expect(domHits("// document 只出现在注释里")).toEqual([]);
    expect(domHits("/* window.innerWidth 与 navigator 都在注释里 */")).toEqual(
      [],
    );
    // 不误报：三种引号的字符串与模板字面量
    expect(domHits('const s = "document";')).toEqual([]);
    expect(domHits("const s = 'navigator.userAgent';")).toEqual([]);
    expect(domHits("const s = `HTMLElement`;")).toEqual([]);
  });

  it("剥离器自证：字符串里的 `//` 不吃掉其后的真代码", () => {
    // 三段串行式剥离器会在这里静默失效（行注释那趟从 `//` 吃到行尾，
    // 留下不成对引号，下一趟把后面的 document 一起吞掉）——单趟交替不会。
    expect(
      domHits('const url = "https://a/b"; const d = document.body;'),
    ).toEqual(["document"]);
    expect(domHits("const t = 'a // b'; const h = HTMLElement;")).toEqual([
      "HTMLElement",
    ]);
  });

  it("ui：除 src/dom/ 外零 DOM 触点", () => {
    const offenders = scannedFiles
      .filter((f) => f.path.startsWith("packages/ui/src/"))
      .map((f) => ({ path: f.path, hits: domHits(f.raw) }))
      .filter((f) => !f.path.startsWith(DOM_DIR))
      .filter((f) => f.hits.some((h) => !allowlisted(f.path, h)));

    expect(
      offenders,
      `纯层出现 DOM 触点（DOM 只许放 ${DOM_DIR}）：` +
        offenders.map((f) => `${f.path} → ${f.hits.join("/")}`).join("；"),
    ).toEqual([]);
  });

  it("shell：零 DOM 触点（宿主装配靠端口注入，不直接摸 DOM）", () => {
    const offenders = scannedFiles
      .filter((f) => f.path.startsWith("packages/shell/src/"))
      .map((f) => ({ path: f.path, hits: domHits(f.raw) }))
      .filter((f) => f.hits.some((h) => !allowlisted(f.path, h)));

    expect(
      offenders,
      "宿主装配层出现 DOM 触点：" +
        offenders.map((f) => `${f.path} → ${f.hits.join("/")}`).join("；"),
    ).toEqual([]);
  });
});

/**
 * eslint 那一道判据的防漂移。
 *
 * `lingfan/pure-layer-no-dom` 的 `files` 比 `lingfan/legacy-webview-compat` 窄，
 * flat config 是**后块覆盖前块**——新块若只带 DOM 项，老 WebView 内建守卫
 * （16 条 MemberExpression 选择器 + structuredClone/BigInt）就会在纯层静默失效
 * （`06` §2.3）。修法是**完整复制**，而复制会随规则演进漂移。
 *
 * 这里用静态断言钉住「复制在位 + 无后块覆盖」，与 `tests/playground/webview-guard.test.ts`
 * 同一手法（读配置源文本）。**行为面**的第二道保险是验收里的手工核查：
 * 在 `packages/ui/src/element/style.ts` 临时插 `structuredClone(1)`，`pnpm lint` 必须报错。
 *
 * 最后的 `eslint 纯层判据（生效面）` 是第三道、也是唯一**正面**的一道：前两道只问
 * 「配置源里写了什么」，问不出「ESLint 实际用了什么」。`lingfan/pure-layer-entry-reexport`
 * 曾只写一条 dom import 选择器，就把 legacy 的 16 条在入口文件上整体覆盖掉了——
 * 配置源里 16 条一条不少，「不含什么」的断言也全绿，可入口处的守卫已经没了。
 * flat config 按**规则名**整体覆盖，只有问 ESLint 本人才能看到这一幕。
 */
/**
 * 老 WebView 那 16 条选择器在配置源里的**唯一定义处**：`LEGACY_WEBVIEW_SELECTORS`
 * 常量。三块（legacy / 纯层 / 入口）都靠展开它拿到自己那一份。
 *
 * 这本身就是那类失效的治根：原先三块各抄一份，规则演进时漏改一处就是静默失效；
 * 现在抄写这个动作在语法上不存在。代价是「从 legacy 块切文本取选择器」的老写法失效，
 * 断言改为「常量里确实有 16 条」+「各块确实展开了常量」+「ESLint 实际生效」。
 */
function legacySelectors(): string[] {
  const at = eslintConfigSource.indexOf("const LEGACY_WEBVIEW_SELECTORS = [");
  expect(at, "配置源缺少 LEGACY_WEBVIEW_SELECTORS 常量").toBeGreaterThan(-1);
  const end = eslintConfigSource.indexOf("\n];", at);
  expect(end, "LEGACY_WEBVIEW_SELECTORS 常量未闭合").toBeGreaterThan(at);
  const block = eslintConfigSource.slice(at, end);
  const selectors =
    block.match(/MemberExpression\[[^\]]*\](?:\[[^\]]*\])*/g) ?? [];
  expect(selectors.length, "LEGACY_WEBVIEW_SELECTORS 不是 16 条").toBe(16);
  return selectors;
}

describe("eslint 纯层判据（配置源结构）", () => {
  const BLOCK = "lingfan/pure-layer-no-dom";
  const LEGACY = "lingfan/legacy-webview-compat";
  const ENTRY_BLOCK = "lingfan/pure-layer-entry-reexport";
  const NEXT_BLOCK = "lingfan/node-side-tooling";

  /** 各块在配置源里的位置；块之间的文本就是该块自己的 rules 区 */
  function blockTexts(): { pure: string; afterPure: string } {
    const pureAt = eslintConfigSource.indexOf(`name: "${BLOCK}"`);
    const legacyAt = eslintConfigSource.indexOf(`name: "${LEGACY}"`);
    const entryAt = eslintConfigSource.indexOf(`name: "${ENTRY_BLOCK}"`);
    const afterAt = eslintConfigSource.indexOf(`name: "${NEXT_BLOCK}"`);
    expect(pureAt, `配置源缺少 ${BLOCK}`).toBeGreaterThan(-1);
    expect(legacyAt, `配置源缺少 ${LEGACY}`).toBeGreaterThan(-1);
    expect(entryAt, `配置源缺少 ${ENTRY_BLOCK}`).toBeGreaterThan(-1);
    expect(afterAt, `配置源缺少 ${NEXT_BLOCK}`).toBeGreaterThan(-1);
    expect(afterAt, `${BLOCK} 必须排在 ${NEXT_BLOCK} 之前`).toBeGreaterThan(
      pureAt,
    );
    // 入口块必须**在纯层块之后**：flat config 后块覆盖前块，反了就变成
    // 入口块被纯层块覆盖（出口放开不生效）或纯层块被入口块覆盖（更糟）。
    expect(entryAt, `${ENTRY_BLOCK} 必须排在 ${BLOCK} 之后`).toBeGreaterThan(
      pureAt,
    );
    return {
      // 只取纯层块自身：入口块的 text 不能被算进来，否则「复制是否完整」会被它稀释
      pure: eslintConfigSource.slice(pureAt, entryAt),
      // 纯层块之后的所有内容：不得再有块覆盖这两条同名规则
      afterPure: eslintConfigSource.slice(afterAt),
    };
  }

  it("纯层块在位，文件域含 ui/shell 且忽略 dom 目录", () => {
    const { pure } = blockTexts();
    expect(pure).toContain('"packages/ui/src/**/*.ts"');
    expect(pure).toContain('"packages/shell/src/**/*.ts"');
    expect(pure).toContain(`"${DOM_DIR}**"`);
  });

  it("纯层块展开老 WebView 守卫的单一来源（否则纯层里静默失效）", () => {
    const { pure } = blockTexts();
    // 治根后的形态：16 条选择器只有一份定义（LEGACY_WEBVIEW_SELECTORS），
    // 纯层块展开它。断言分两层——常量本身确实是 16 条，纯层块确实展开了常量。
    // 「纯层块文本里出现 16 条字面量」那种断言已经不该成立：逐字复制正是漂移的
    // 来源（漏改一处 ⇒ 某块静默失效），本文件要防的正是这件事。
    expect(legacySelectors()).toHaveLength(16);
    expect(
      pure,
      "纯层块没有展开 LEGACY_WEBVIEW_SELECTORS——老 WebView 守卫会在纯层静默失效",
    ).toContain("...LEGACY_WEBVIEW_SELECTORS");
    expect(
      pure,
      "纯层块没有展开 LEGACY_WEBVIEW_GLOBALS——structuredClone/BigInt 会在纯层静默失效",
    ).toContain("...LEGACY_WEBVIEW_GLOBALS");
    for (const name of ["structuredClone", "BigInt"]) {
      expect(eslintConfigSource, `单一来源里缺少全局 ${name}`).toContain(
        `name: "${name}"`,
      );
    }
  });

  it("纯层块带齐 15 项 DOM 全局与 dom 目录 import 拦截", () => {
    const { pure } = blockTexts();
    const DOM_GLOBALS = [
      "window",
      "document",
      "navigator",
      "localStorage",
      "sessionStorage",
      "HTMLElement",
      "Element",
      "Node",
      "HTMLDivElement",
      "HTMLImageElement",
      "HTMLVideoElement",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "ResizeObserver",
      "matchMedia",
    ];
    for (const name of DOM_GLOBALS) {
      expect(pure, `纯层块缺少 DOM 全局 ${name}`).toContain(`name: "${name}"`);
    }
    // dom 目录的 import 拦截（转义后是 \\.\\/dom）
    expect(pure).toMatch(
      /ImportDeclaration\[source\.value=\/\^\\\\\.\\\\\/dom\/\]/,
    );
    // 再导出与 import 等价：`export { x } from "./dom"` 会把 DOM 实现重新暴露给下游，
    // 纯层的「零 DOM」在入口处就被绕开。命名导出与 `export *` 是两种 AST 形态，各要一条。
    // 三条的判据段必须逐字相同——判据不一致就等于某个入口的守卫是假的。
    const importAt = pure.indexOf("ImportDeclaration[source.value=");
    expect(
      importAt,
      "纯层块缺少 ImportDeclaration 的 dom 拦截",
    ).toBeGreaterThan(-1);
    const predicateTail = pure.slice(importAt + "ImportDeclaration".length);
    const canonical = predicateTail.slice(
      0,
      predicateTail.indexOf("/]") + "/]".length,
    );
    for (const prefix of ["ExportNamedDeclaration", "ExportAllDeclaration"]) {
      const at = pure.indexOf(`${prefix}[source.value=`);
      expect(at, `纯层块缺少 ${prefix} 的 dom 拦截`).toBeGreaterThan(-1);
      const actual = pure.slice(
        at + prefix.length,
        at + prefix.length + canonical.length,
      );
      expect(actual, `${prefix} 的判据与 import 那条不一致`).toBe(canonical);
    }
  });

  it("包根入口的放开面只有出口那两条，全局判据仍由纯层块生效", () => {
    // 入口 `packages/ui/src/index.ts` 必须能再导出 dom 成品（package.json 只有一条
    // exports，宿主拿不到深路径）。放开的代价被限制在这个文件、且只限出口两条：
    // 一旦这个块里冒出 no-restricted-globals，纯层块那 15 项 DOM 全局 + structuredClone
    // /BigInt 就会在入口默默失效——正是本文件要防的那类静默回归。
    const entryAt = eslintConfigSource.indexOf(`name: "${ENTRY_BLOCK}"`);
    expect(entryAt, `配置源缺少 ${ENTRY_BLOCK}`).toBeGreaterThan(-1);
    const entry = eslintConfigSource.slice(
      entryAt,
      eslintConfigSource.indexOf(`name: "${NEXT_BLOCK}"`, entryAt),
    );
    expect(entry).toContain('"packages/ui/src/index.ts"');
    expect(entry, "入口块不得重述全局判据（会让纯层块失效）").not.toContain(
      '"no-restricted-globals"',
    );
    expect(entry, "入口块不得放开再导出").not.toContain(
      "ExportNamedDeclaration[source.value=",
    );
    expect(entry, "入口块不得放开 export *").not.toContain(
      "ExportAllDeclaration[source.value=",
    );
  });

  it("纯层块之后没有块再覆盖这两条同名规则（flat config 后块覆盖前块）", () => {
    const { afterPure } = blockTexts();
    expect(afterPure).not.toContain('"no-restricted-globals"');
    expect(afterPure).not.toContain('"no-restricted-syntax"');
  });
});

/**
 * 生效面：问 ESLint 本人「这个文件最终用的规则是什么」。
 *
 * 上面「配置源结构」那组断言有个盲区——它们只检查某个块的**文本**里有没有某条
 * 选择器，检查不出这条选择器是否还活着。flat config 是按**规则名整体覆盖**的：
 * 只要后面的块为同一个文件配了 `no-restricted-syntax`，前面块的那份数组就整个作废。
 * 于是「16 条都写在纯层块里」与「入口文件上 16 条一条都没生效」可以同时为真——
 * 这正是 `lingfan/pure-layer-entry-reexport` 第一次落地时的实况，而那组断言全绿。
 *
 * 所以这里不用配置源文本，用 `ESLint#calculateConfigForFile`：它算的就是 lint 时
 * 真正采用的那份。代价是这个 API 每次约 2.5s（首次还要加载整份配置），只在
 * `beforeAll` 里跑一遍、四个文件共用。
 */
describe("eslint 纯层判据（生效面）", () => {
  const ENTRY_FILE = "packages/ui/src/index.ts";
  const PURE_FILE = "packages/ui/src/element/style.ts";
  const DOM_FILE = "packages/ui/src/dom/materialize.ts";

  /** 16 条老 WebView 守卫：取自配置源的单一来源常量（见文件上部同名辅助） */
  // 这里复用模块级的 legacySelectors()，不再从 legacy 块切文本——
  // 那 16 条现在只存在于 LEGACY_WEBVIEW_SELECTORS 常量里。

  /** 某文件上生效的 `no-restricted-syntax` 选择器列表（字符串形态） */
  async function effectiveSyntax(file: string): Promise<string[]> {
    const eslint = new ESLint({
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
    });
    const config = await eslint.calculateConfigForFile(file);
    const rule = config.rules?.["no-restricted-syntax"];
    if (!Array.isArray(rule)) return [];
    return rule
      .slice(1)
      .map((entry: unknown) =>
        typeof entry === "string"
          ? entry
          : (entry as { selector?: string }).selector,
      )
      .filter((s): s is string => typeof s === "string");
  }

  const effective = new Map<string, string[]>();

  beforeAll(async () => {
    for (const file of [ENTRY_FILE, PURE_FILE, DOM_FILE]) {
      effective.set(file, await effectiveSyntax(file));
    }
  }, 120_000);

  function syntaxOf(file: string): string[] {
    const list = effective.get(file);
    if (!list) throw new Error(`没有探测 ${file} 的生效配置`);
    return list;
  }

  it("入口文件：legacy 的 16 条选择器全部生效（不是只写在别的块里）", () => {
    const actual = syntaxOf(ENTRY_FILE);
    const missing = legacySelectors().filter((s) => !actual.includes(s));
    expect(
      missing,
      `入口 ${ENTRY_FILE} 上失效的老 WebView 守卫：${missing.join(" / ")}` +
        "——flat config 按规则名整体覆盖，只保留入口块自己的那一条会让它们全部消失",
    ).toEqual([]);
  });

  it("入口文件：dom import 拦截生效，两条 export 选择器被放开", () => {
    const actual = syntaxOf(ENTRY_FILE);
    expect(
      actual.some((s) => s.startsWith("ImportDeclaration[source.value=")),
      '入口必须仍拦 `import … from "./dom"`',
    ).toBe(true);
    // 例外只放开出口两条：入口再导出 dom 成品是既定架构（package.json 只有一条
    // exports，宿主拿不到深路径），但也不能把 export 拦截留在入口上。
    for (const prefix of ["ExportNamedDeclaration", "ExportAllDeclaration"]) {
      expect(
        actual.some((s) => s.startsWith(`${prefix}[source.value=`)),
        `入口不该拦 ${prefix}（那正是已批准的入口例外）`,
      ).toBe(false);
    }
  });

  it("非入口纯层文件：三条 dom 拦截齐全（import + export 两种形态）", () => {
    const actual = syntaxOf(PURE_FILE);
    for (const prefix of [
      "ImportDeclaration",
      "ExportNamedDeclaration",
      "ExportAllDeclaration",
    ]) {
      expect(
        actual.some((s) => s.startsWith(`${prefix}[source.value=`)),
        `${PURE_FILE} 缺少 ${prefix} 的 dom 拦截`,
      ).toBe(true);
    }
    const missing = legacySelectors().filter((s) => !actual.includes(s));
    expect(missing, `非入口文件上失效的守卫：${missing.join(" / ")}`).toEqual(
      [],
    );
  });

  it("dom 目录内：三条 dom 拦截都不生效（DOM 实现在这里，判据不适用）", () => {
    const actual = syntaxOf(DOM_FILE);
    for (const prefix of [
      "ImportDeclaration",
      "ExportNamedDeclaration",
      "ExportAllDeclaration",
    ]) {
      expect(
        actual.some((s) => s.startsWith(`${prefix}[source.value=`)),
        `${DOM_FILE} 不该被 dom 拦截命中（ignores 未生效）`,
      ).toBe(false);
    }
    // 老 WebView 守卫在 dom/ 里仍然生效：那里的 DOM 代码一样要在基线 WebView 跑
    const missing = legacySelectors().filter((s) => !actual.includes(s));
    expect(missing, `dom/ 里失效的守卫：${missing.join(" / ")}`).toEqual([]);
  });

  it("入口文件的全局判据没有被本块覆盖（17 项仍由纯层块生效）", async () => {
    const eslint = new ESLint({
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
    });
    const config = await eslint.calculateConfigForFile(ENTRY_FILE);
    const rule = config.rules?.["no-restricted-globals"];
    expect(
      Array.isArray(rule),
      "入口文件没有生效的 no-restricted-globals",
    ).toBe(true);
    const names = (rule as unknown[])
      .slice(1)
      .map((g) => (typeof g === "string" ? g : (g as { name?: string }).name))
      .filter(Boolean);
    // 2 项老 WebView + 15 项 DOM，共 17
    expect(names, `入口全局判据缺项：${names.join(",")}`).toHaveLength(17);
    for (const name of ["structuredClone", "BigInt"]) {
      expect(names, `入口缺少 ${name}`).toContain(name);
    }
  }, 60_000);
});
