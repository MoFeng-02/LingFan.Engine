---
title: TS 创作模式
description: 在工程平级放 Stories.src/，用原生 TypeScript 写故事，构建期静态编译成现有 JSON 产物。含词汇层导入写法、npm 依赖的可用边界与构建期报错原文。
---

手写 `.story` 和直接编辑 JSON 之外，还有第三条写故事的路径：在工程根平级放一个 `Stories.src/` 目录，用原生 TypeScript 写。

产出的仍然是 `Resources/Stories/` 下那套 JSON，一行不变。引擎、Rust 层、编辑器读的都是 JSON，对 TS 源零感知——TS 只在构建期存在，运行期没有它。

```text
你的工程/
├── Stories.src/          ← 你写这个
│   ├── config.ts
│   └── chapter1/start.ts
└── Resources/
    └── Stories/          ← 构建产物，引擎读这个
        └── chapter1/start.json
```

## 什么时候该用它

写长故事、有大量条件分支和循环、想用类型系统约束状态键、或者依赖某个 npm 包里的纯数据表时，TS 模式比手写文本省事。

只想改两句台词、或者工程里已经有 `.story` 且跑得好，别迁移——这条路径的编译链仍在实现中，没走完的能力见文末「实现状态」。

## config.ts

`Stories.src/config.ts` 是这个目录根级唯一允许的 `.ts`，声明哪些目录参与构建、哪个文件是入口。推荐用 default 对象形态——单一强类型出口，配合 `satisfies StoriesConfig` 获得字段补全与拼写检查（`StoriesConfig` 是全局类型，来自 `@lingfan-engine/stories-build` 的创作垫片，无需 import）：

```ts
// apps/playground/Stories.src/config.ts
export default {
  folders: ["chapter1", "chapter2", "chapter3", "chapter4"],
  start: "start.ts",
} satisfies StoriesConfig;
```

兼容 named exports 形态（`export const folders = [...]; export const start = "..."`），与 default 对象等价；同一文件里两种形态混用会报错——契约来源必须唯一。default 对象除 `folders` / `start` 外还可带 `version` / `vars` / `state` 字段（语义与同名导出一致，见后文）。`folders` / `start` 缺失、键名拼错都会在构建期报错——求值器只读认识的名字，写错的键不会静默生效，default 形态还有 `satisfies` 在 IDE 里提前标红。

`folders` 是目录名数组，相对 `Stories.src/`，每个目录递归扫描。写 `"*"` 表示「凡含故事的目录自动纳入」——省掉每加一章就回来改配置：

```ts
export default {
  folders: ["common", "*"],
  start: "main.ts",
} satisfies StoriesConfig;
```

`folders` 为空且不含 `"*"` 会在构建期报错，不会静默编译出零列。

`start` 是故事文件名（含 `.ts`），按文件名跨所有目录查找。全局恰好命中一个才行：命中 0 个或 ≥2 个都报错，并把候选文件列出来。命中的那个文件会写进 `project.json` 的 `entry`。

除 `config.ts` 外，`Stories.src/` 根级再出现 `.ts` 会报错——引导你放进子目录。

## 一个文件是一列，还是零列

规则只有一条，看这个文件怎么导出：

```ts
// 有 default 具名函数 → 这是一列
export default function tavern(): void {
  say("欢迎光临。");
}
```

`export default function tavern()` 里的 `tavern` 就是列 id。跟 `label tavern:` 等价。必须先写 `function` 声明——写成匿名箭头或 `export default () => {}` 会在构建期报错「default 导出必须是具名函数声明」，因为列 id 没有地方可取。

```ts
// 只有具名导出、没有 default → 这是纯模块，产不出列
export function farewell(who: string): void {
  say(`${who}，慢走。`, who);
}
```

纯模块装函数和常量，被故事文件 `import` 使用。上面这个 `farewell` 被 `chapter1/inn.ts` 引用；它自己不产生任何列，放哪个目录都行。

列 id 在整个工程内唯一，跟 JSON 形态一个口径。两个文件都用 `export default function main()` 就是重名列 id，报错会带上两处文件定位。

## 语句怎么变成 op

这是整个模式的机制：**构建期把你的 TS 语句静态转译成 op 序列，运行期交给引擎执行**。TS 代码本身从不运行——除了下面说的模块层常量。

| 你写的 TS                              | 编译成                                         |
| -------------------------------------- | ---------------------------------------------- |
| `say(…)` / `menu(…)` / `guard(…)`      | 同名 op，形状与词汇层一致                      |
| `if (c) {…} else if (c2) {…} else {…}` | `if` op 带 `cond` / `then` / `elif[]` / `else` |
| `while (c) {…}`                        | `while` op                                     |
| `for (let i = 0; i < n; i++)`          | `let` + `while`，循环体尾自动推进              |
| `for (const v of state.items)`         | `for` op                                       |
| `switch (e) { case v: … }`             | `switch` op，case 值限字面量                   |
| `break` / `continue`                   | `break` / `continue` op，绑定最近的循环        |
| `function f(a, b) {…}` + 调用          | `func` op 前置到列头 + `call` op               |
| `let x = e`                            | `let` op，运行期局部变量                       |
| `state.gold = 10` / `state.gold += 5`  | `set` op，复合赋值保留 `+=` 语义               |
| `` `你有 ${state.gold} 金币` ``        | 字符串 `你有 {gold} 金币`                      |

自定义函数不会内联展开，而是编译成一个真子程序：函数定义发 `func` op 前置到列的命令序列头部，每个调用点发 `call` op。递归因此可用。

函数可以带值返回：`return v` 编译成 `ret` op，值送给带 `into` 的调用点——`const r = someFunc()` 会把返回值绑成局部变量 `r`，`{r}` 可直接插值；没有接收点的调用处返回值丢弃，不报错。

```ts
function greet(who: string): void {
  say(`${who}，欢迎来到灵泛！`, who);
}

export default function start(): void {
  greet("旅人"); // → call greet，运行期真跳一次
}
```

跨文件用函数要 `export` + `import`。没 `export` 的模块级函数只在本文件里可见。

### 从词汇层取词函数的写法

`@lingfan-engine/editor` 的词函数有四种取法，都成立：

| 你写的 TS                                                                | 取到什么              |
| ------------------------------------------------------------------------ | --------------------- |
| `import { say, menu } from "@lingfan-engine/editor";`                    | 词函数本身，直接调用  |
| `import { script } from "@lingfan-engine/editor";`，之后 `script.say(…)` | 词汇层命名空间        |
| `import * as ct from "@lingfan-engine/editor";`，之后 `ct.say(…)`        | 整套命名空间          |
| 不写 import，直接 `script.say(…)`                                        | 免导入直呼（ambient） |

改短名用 `as`：`import { say as 说 }`、`import { script as ct }` 都可以，命名空间起别名之后里面的词函数跟着别名走。

免导入直呼是构建生成的 ambient 声明：`Stories.src/gen/script.gen.d.ts` 里一条 `declare const script` 指向词汇层命名空间，纯编译期类型面、零运行时注入。模块里自有同名声明（函数、导入）按 TS 遮蔽语义优先于它，显式导入与重命名不受影响；写错词名仍在构建期报错，文案会指路 `script.` 命名空间与具名导入两条正路。

下面四种写法在构建期报错。报错原文照抄，各例只差导入那几行：

```ts
import script from "@lingfan-engine/editor"; // ← 默认导入

export default function start(): void {
  script.say("默认导入。");
}
```

```text
故事编译失败（2 条）：
- ch1/start.ts:1:8 词汇层请以具名导入（import { say, … } from "@lingfan-engine/editor"）或 script 命名空间使用
- ch1/start.ts:4:3 方法调用不支持：词函数通过具名导入或 script 命名空间调用
```

```ts
import * as v from "../lib/cast"; // ← 相对模块的命名空间

export default function start(): void {
  v.say("相对模块命名空间。");
}
```

```text
故事编译失败（2 条）：
- ch1/start.ts:1:8 命名空间导入仅支持词汇层 script
- ch1/start.ts:4:3 方法调用不支持：词函数通过具名导入或 script 命名空间调用
```

```ts
import { say, notAWord } from "@lingfan-engine/editor"; // ← 词汇层里没有 notAWord

export default function start(): void {
  say("不存在的词。");
}
```

```text
故事编译失败（1 条）：
- ch1/start.ts:1:15 词汇层不存在词 `notAWord`
```

```ts
import "@lingfan-engine/editor"; // ← 副作用导入
import { say } from "@lingfan-engine/editor";

export default function start(): void {
  say("副作用导入。");
}
```

```text
故事编译失败（1 条）：
- ch1/start.ts:1:1 副作用导入不支持：请显式导入所需符号
```

**为什么词函数必须经 `@lingfan-engine/editor` 导入**：词汇层是构建期的子语言，词调用在构建期被静态转译成 op，运行期不存在 `script` 这个对象。编译器必须直接从导入语句看出你说的是哪个词，只有 `@lingfan-engine/editor` 的具名导入和它的 `script` 命名空间带着这个信息。

`staticFor` 是编译期循环——展开成静态命令，不是运行期循环：

```ts
staticFor(3, (i) => [say(`第 ${i + 1} 组。`)]);
```

`i` 在编译期就被代换成字面量，产物里是三条独立的 `say`，运行期看不到循环。

### 哪些 TS 语法不支持

这些形态会在构建期报错，而不是被悄悄忽略：

- `for (const k in obj)`——引擎没有对象键枚举语义
- `state.a.b = e`——引擎的 `set` 键是平名；深字段要走词函数 `dictSet`
- `const f = () => {}`——自定义函数只认 `function` 声明

条件表达式、`let` 的值、实参这些位置能写什么，由引擎的表达式文法决定，不是 TS 的子集。字面量、`state.a.b` 路径、局部变量名、运算符组合、内建函数调用（`random`/`min`/`max`/`abs`/`clamp`/`arrayGet`/`dictGet`/`optGet`/`len`）都可以；`new`、方法调用、`typeof`、解构、展开，以及内建之外的函数调用一律构建期报错。

可选链与下标访问是例外里的例外：`state.player?.nick` 会被脱糖成引擎的 `optGet("player.nick")`（路径缺失得到 null，`state.` 前缀在产物里剥离），`state.bag[0]` 脱糖成 `arrayGet("bag", 0)`，`state.cfg["speed"]` 脱糖成 `dictGet("cfg", "speed")`，`len(state.bag)` 取长度。四者只在值位置可用——`for...of` 集合、赋值目标仍只认真实存在的路径；路径型内建也接受不了变量当路径（路径须在构建期定型）。缺失值配 `??` 兜底：

```ts
let nick = state.player?.nick ?? "无名";
say(`称呼：${nick}`);
state.last = state.bag[0] ?? 0;
say(`件数：${len(state.bag)}`);
say(`缺席：${state.cfg["ghost"] ?? "无"}`);
```

## npm 依赖

判断标准一句话：**npm 包当纯数据来源用，支持；当运行期行为用，不支持。**

分界线是代码写在模块层还是函数体里。

### 能用：模块层 `const`

```ts
import { 天气表 } from "some-data-pkg";
import { 城市 } from "another-pkg";

const 默认城 = 天气表[城市.北京]; // 求值链上的其他 const 也允许
```

这种写法会在构建期真的执行一次，把结果内联进 JSON 产物。包代码本身不进产物，只留求值后的值。所以结果必须 JSON 可序列化——标量、数组、纯对象。函数值、类实例、`Symbol`、循环引用都会报错。

求值依赖链上的其他模块 `const` 和 npm 导入都可以，但**必须收敛为 `export` const**。`Stories.src` 里非导出的 const 中转会被拦下：

```text
模块层 const 引用了 node_modules 值导入——仅导出的 const 可经编译期求值内联
（请把 npm 值收敛为导出 const）
```

求值结果还不许依赖不确定源：`Date.now()`、`new Date()`、`Math.random()`、crypto 随机、文件/网络/进程 IO。构建器会把同一个常量在隔离环境求值两次比对结果，两次不一致就报错——这条是硬闸门，不是文案建议。

### 不能用：函数体和控制流里引用 npm 值

```ts
import axios from "axios";

export default function start(): void {
  const http = axios.get("https://api.example.com/data");   // ← 报错
  if (http.status === 200) { … }
}
```

这一处实际只报一条——故事文件里的 npm 值导入在第一道求值闸门就被拦下，走不到后面：

```text
编译期求值失败（1 条）：
- Stories.src/ch1/start.ts:1:1 故事文件不支持 node_modules 值导入 `axios`——npm 值请收敛为纯模块的导出 const（编译期求值仅作用于纯模块），再经相对导入使用（编译期求值引用域规则）
```

「函数体里引用 npm 值」那条编译期求值报错要换个位置才看得到：把 npm 导入放进纯模块，再在同一个模块的函数体里引用它。

```ts
// Stories.src/lib/endpoint.ts
import { version } from "typescript";

export const v = version;

function describe(): void {
  say(version); // ← 报错
}
```

```text
故事编译失败（1 条）：
- lib/endpoint.ts:6:7 node_modules 值导入 `version` 仅限模块层 const 初始化链（编译期求值引用域规则）：函数体与其他语句不得引用
```

它由 `packages/stories-build/src/compiler/story-compiler/graph/bindings.ts:221` 发出，前提是这个模块被编译期求值过、且这个包在工程里能解析。

编译器里另有一道兜底：没被求值过的文件出现外部包导入时，`packages/stories-build/src/compiler/story-compiler/graph/imports.ts:81` 用「导入仅限相对路径与词汇层既有出口，不支持外部包 `x`」拒绝。上面这个例子里它不会触发。

另外，就算绕过去，`axios.get()` 返回的是 Promise，不是 JSON 可序列化值。

**根本原因**：这个模式是「创作期静态转译成 op、运行期引擎接管」。故事里「发 HTTP 请求 → 看响应分支」是**运行期**行为，必须由引擎的 op 表达。构建期执行那一次 `axios.get()`，拿到的是你构建机器当下的响应——跟玩家跑游戏时该不该发这个请求，是两件事。分支在编译期就定死了，玩家永远只走那一条。

### 要做「请求 → 分支」的正确姿势

把 npm 值限制在模块层当纯数据，运行期行为交给 `extOp`：

```ts
import { 默认端点 } from "some-config-pkg";

const 端点 = 默认端点; // 模块层，编译期内联成字符串

export default function start(): void {
  extOp("http.get", { url: 端点, saveTo: "player.apiData" }); // 运行期由引擎执行
  if (state.player.apiData.status === 200) {
    // 引擎运行期分支
    say("请求成功。");
  }
}
```

`extOp` 调用的命令名要引擎侧真的注册过才有意义，否则空转。写 `extOp("http.get", …)` 而引擎没装这个 op，跟写其它未注册命令一样不会生效——新增 op 是引擎侧的事，见[扩展引擎](/concepts/extensions/)。

## 构建与产物

```powershell
pnpm stories:build        # 编译一次
pnpm stories:watch        # 改完自动重编译
pnpm stories-typecheck    # tsc --noEmit 类型检查
```

产物写到 `Resources/Stories/`，路径镜像源文件路径——`Stories.src/chapter1/start.ts` 编译成 `Resources/Stories/chapter1/start.json`。TS 源工程对列集是**全量管理**：源里没有的列，构建期从产物目录删掉，删除项逐条列在报告里。

忘记把新章节加进 `folders` 不会静默变成「陈旧删除」——覆盖范围外发现 `default` 导出会直接报错。

源里有 `default` 导出但所在目录没被 `folders` 覆盖，报错会指出文件路径。

编辑器对 TS 源工程的 JSON 产物只读，改列请在源里改。

## 实现状态

TS 创作模式在实现中，还没有对外发布。构建 CLI、语句转译、编译期常量求值器都已落地并通过测试，构建链也已经完成包化：构建入口是独立的 `@lingfan-engine/stories-build` 包，工程里随构建生成的 `Stories.src/gen/stories.gen.d.ts` 把本工程的列名与插值键交给 IDE 做即时校验。`stories:watch` 已是常驻增量监听：保存源文件即重编译，产物与全量构建逐字节一致，并会报出本轮差量与受影响的故事列。

具体到你写故事时可能碰到的：

- 词汇层出口由源生成：`vocabulary.g.ts` 由 generate-vocabulary CLI 从 words/ 源自动生成，并带 fail-closed 登记一致性校验。引擎加了新 op，跑一次生成即同步，无需手写。
- `extOp` 能调用哪些命令名，取决于引擎侧注册了哪些——这套创作模式本身不新增 op。
- `state` 的声明住进 `Stories.src`：`config.ts` 或任意模块的顶层（函数体之外）都可以调 `define` 累积，构建期求值后汇入同一棵树降维为扁平 defines——跨文件同键定义会一次报出全部位置；`defineVars`（插值键登记）仍只在 `config.ts`。构建同时把合并树生成成精确类型面 `Stories.src/gen/state.gen.d.ts`（枚举走 `import type` 引用，descriptor 按槽位取类型），工程侧桥文件（如 `Stories.src/lib/state-root.d.ts`）`import type { StoryState }` 后 `declare global` 挂上状态根——IDE 里的 `state.…` 跳转和检查都是精确类型，不再依赖宽索引签名。`@lingfan-engine/stories-build` 包出口仍提供宽类型垫片，仅供未接桥的工程作缺省回退。
- 状态值域：`null` 是状态槽的合法空值（`type: "number", default: null` 或运行期 `set` 写入都行；`undefined` 才等于销毁键），需要 `??` 兜底的表达式可以直接吃 null。descriptor 的 `type` 槽还支持并集：`type: ["number", Sex, null]` 声明「数字或枚举 Sex 或空」，构建按成员生成精确类型（`number | Sex | null`，枚举仍走 `import type`），`default` 必须落在至少一个成员的值域内，未知成员一次报全部；形态 A 用 `as const` 元组获得同样的静态推导。
- 插值键注册表自动收声明名：故事体里的 `let n = 0`、`local("k", …)`，以及 `const r = someFunc()` 这类取函数返回值的声明——引擎会把返回值绑定名声明成局部变量，`{r}` 因此是合法插值，构建会把这些名字自动登记进插值键注册表，无需再手填 `defineVars`；与 state/define 键同名时按键去重，不报错。
- 模块层角色声明：`config.ts` 或任意模块的顶层（函数体之外）可以调 `character(key, spec)` 声明角色，构建期求值后前置到每一列的命令头部（按 key 码元序，先于列体任何命令）——写作时不必在每个故事文件里重复登记。六字段 `name` / `color` / `size` / `font` / `textColor` / `screen` 走构建期常量求值，未知字段、非字符串值、key 非字符串字面量都 fail-closed；跨文件同名不同义一次报两处声明位置，全等声明幂等不报。列内 `character` 词调用仍可用，运行期覆盖模块层声明（同键整条替换，与 JSON 形态同一规则）。模块层调用经免导入直呼（`script.gen.d.ts` 指向词汇层命名空间，`character` 词本就在列）有完整类型提示；模块里自有同名声明按 TS 遮蔽语义优先，构建期会拒绝本地遮蔽 `character` 标识符的模块（避免把构建期声明误当运行期词）。注销用运行期词 `uncharacter(key)`（词汇层导出，函数体内调用）：注销后 `say` 不再套该角色样式，键不存在发 `character.missing` 知情事件不停机，随回溯回滚。
- 字体名注册表：把字体文件放进 `Resources/Fonts/` 即完成注册，字体名 = 文件名去扩展名（`楷体.ttf` → `楷体`）。故事层只写字体名字符串——`{font=楷体}` 行内标签或 say 的 `font` 参数；构建期对静态引用 fail-closed（未注册名直接报错并给位置），插值拼出来的动态名字在运行期回退默认字体并由宿主输出诊断。参考宿主会自动为 `Resources/Fonts` 的字体注入 `@font-face`，无需手写样式。构建还会生成 `Stories.src/gen/font.gen.d.ts`（`font["楷体"]` 声明式取名，拼错字在类型检查即红）。整句字体按四级解析：say 行参 `font` > 角色字体（`character` 的 `font`）> 列级字体（故事文件顶层 `const columnFont = "楷体";`）> 项目默认（宿主 CSS 变量，参考宿主即 `--lf-story-font`）。
- 存档随故事升级：`config.ts` 可以声明 `version`（正整数，default 对象字段或 named export）——写档时随档落盘；读档时若当前故事声明了 version 且与档内不一致，引擎把存档状态交给构造引擎时提供的 `migrateState` 钩子迁移（成功发通知、无法迁移整档拒绝），当前故事没声明 version 则不做对账、新旧档都直读。另外：故事里 `undef` 销毁过的全局键会以墓碑形式记进存档，读档垫底（新增 define 默认值补齐）不会让它们复活；小游戏若回填过状态，读档会按注册的 `stateVersion` 校验并迁移（与扩展依赖标记同一套语义）。

## 下一步

- [故事与叙事流](/concepts/story/)：列、等待点、跳转的运行期规则。
- [状态与变量](/concepts/state/)：`state.gold` 这类路径在运行期怎么读写。
- [扩展引擎](/concepts/extensions/)：`extOp` 指向的自定义 op 怎么注册。
