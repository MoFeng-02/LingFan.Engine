/**
 * Script 词汇层 · **变量句柄与表达式构造**。
 *
 * 引擎表达式是字符串（`{player.gold >= 25}`）——求值归引擎（回溯确定性根基），
 * 本模块只负责**生成**表达式文本：显式注册制带来 IDE 补全、
 * 拼写检查（未注册变量在 expr 求值时抛错）与统一的 `{}` 包装。
 *
 * **构建期轻类型校验**：`expr`/`cond` 组装时按
 * **引擎求值器的类型规则与优先级链**（`runtime/expr.ts`——口径权威）做递归下降
 * 判类，命中记入**警告池**（`drainExpressionWarnings()` 取走）。这是编辑期诊断与
 * 运行期 type-error 的构建期预告——**不拦构建、不改产物**，引擎求值与编辑期诊断
 * 仍是权威。手写片段里的未知结构（函数调用、括号组、裸变量名、成员路径）一律
 * unknown 传播——**宁可漏报不误报**：警告的价值建立在零误报上。
 *
 * 引擎表达式全集（函数调用、嵌套括号等）不进本层——句柄只覆盖「变量引用」
 * 这一最高频片段，其余手写字符串（契约：不发明引擎没有的语义）。
 */

/** 变量种类（注册时声明；构建期轻校验的判类依据） */
export type VarKind = "num" | "str" | "bool";

export interface VarHandle {
  readonly kind: VarKind;
  /** 引擎状态键（如 `player.gold`） */
  readonly key: string;
}

const VAR_KINDS: ReadonlySet<string> = new Set(["num", "str", "bool"]);

/** 真句柄 = kind 为三种之一且 key 为字符串——未注册子树 Proxy 的 kind 是对象，判否 */
function isVarHandle(value: unknown): value is VarHandle {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { kind?: unknown; key?: unknown };
  return (
    typeof candidate.kind === "string" &&
    VAR_KINDS.has(candidate.kind) &&
    typeof candidate.key === "string"
  );
}

/** 嵌套句柄树（`vars.player.gold` ⇒ handle{key: "player.gold"}） */
export interface VarTree {
  [prop: string]: VarTree | VarHandle;
}

/** 当前注册表（`expr` 标签读取；`defineVars` 绑定——每个故事源文件声明一次） */
let currentRegistry: ReadonlyMap<string, VarKind> | null = null;

/** 构建期警告池（与 currentRegistry 同范式的模块态：一次导入 = 一个故事源；drain 后清零） */
let warningSink: ExpressionWarning[] = [];

/**
 * 取走并清空构建期警告。stories-build 在源模块导入完成后调用一次进 BuildReport；
 * 连续两次调用，第二次必为空（drain 即清零）。
 */
export function drainExpressionWarnings(): readonly ExpressionWarning[] {
  const out = warningSink;
  warningSink = [];
  return out;
}

/**
 * 构建期轻类型校验警告（引擎 type-error 的构建期预告；不拦构建）。
 * 规则名与引擎 `runtime/expr.ts` 的类型规则一一对应（见 `ExpressionAuditor`）。
 */
export interface ExpressionWarning {
  /** 完整表达式文本（含 `{}` 包装） */
  readonly expression: string;
  readonly rule:
    | "arith-non-num"
    | "compare-non-num"
    | "equality-kind-mismatch"
    | "logical-non-bool"
    | "unary-not-non-bool"
    | "unary-minus-non-num"
    | "ternary-cond-non-bool"
    | "interpolation-inside-string"
    | "unclosed-string-literal";
  /** 人话说明（含引擎将抛的 type-error 语义与出错操作数） */
  readonly message: string;
}

function makeTree(
  prefix: string,
  handles: ReadonlyMap<string, VarHandle>,
): VarTree {
  return new Proxy({} as VarTree, {
    get(_target, prop): VarTree | VarHandle {
      if (typeof prop !== "string" || prop === "then") {
        throw new Error(
          `变量句柄路径非法：${String(prop)}（前缀 ${prefix || "(根)"}）`,
        );
      }
      const key = prefix === "" ? prop : `${prefix}.${prop}`;
      const handle = handles.get(key);
      if (handle !== undefined) return handle;
      // 未注册路径：继续给子树 Proxy（链式展开），expr 求值时校验终值
      return makeTree(key, handles);
    },
  });
}

/**
 * 声明变量清单并绑定为本文件的 `expr` 上下文。
 * 每个故事源文件调用一次（重复调用 = 覆盖前一份注册表——源文件间的变量清单
 * 各自独立声明，不共享）。
 *
 * ```ts
 * const vars = defineVars({ "player.gold": "num", "player.name": "str" });
 * cond`${vars.player.gold} >= 25` // ⇒ "{player.gold >= 25}"
 * ```
 */
export function defineVars(spec: Record<string, VarKind>): VarTree {
  currentRegistry = new Map(Object.entries(spec));
  const handles = new Map<string, VarHandle>(
    Object.entries(spec).map(([key, kind]) => [key, { kind, key }]),
  );
  return makeTree("", handles);
}

/** 句柄对应的注册键（expr 内部用；未注册 ⇒ 抛错——拼写错误在构建期就红） */
export function varKeyOf(
  handle: VarHandle,
  registry: ReadonlyMap<string, VarKind>,
): string {
  if (!registry.has(handle.key)) {
    throw new Error(
      `未注册的变量：${handle.key}——请在 defineVars 清单中声明后再引用`,
    );
  }
  return handle.key;
}

// ====== 构建期轻类型校验（判类器镜像引擎 runtime/expr.ts 的规则与优先级链）======

type OperandKind = VarKind | "unknown";

type AuditToken =
  | {
      readonly t: "operand";
      readonly kind: OperandKind;
      readonly label: string;
    }
  | { readonly t: "op"; readonly text: string }
  | { readonly t: "punct"; readonly text: string };

const BAIL = Symbol("audit-bail");

/**
 * 递归下降判类器——**优先级链与引擎逐层一致**：`?: → || → && → ==/!= → 比较 →
 * + - → * / % → 一元 → 成员/调用`。相邻配对会在 `isVIP || gold == 1` 这类
 * 优先级场景错怪操作数，故必须按结构配对。
 *
 * 类型传播口径（与引擎「输入合型 ⇒ 有结果必为输出型」一致）：
 * - 违规（已知操作数不合运算符要求）⇒ 记警告，结果按 unknown（防连锁噪声）；
 * - 无违规 ⇒ 结果 = 运算符输出型（算术 num / 比较·相等·逻辑·`!` bool / 一元减 num），
 *   即使另一侧 unknown——引擎在「不报错」的前提下结果型是确定的。
 */
class ExpressionAuditor {
  private pos = 0;

  constructor(
    private readonly tokens: readonly AuditToken[],
    private readonly pending: Array<{
      rule: ExpressionWarning["rule"];
      message: string;
    }>,
  ) {}

  /** 入口：整体解析一次；任何结构不理解 / 残留 token ⇒ 全部放弃（零误报） */
  audit(): void {
    const saved = [...this.pending];
    try {
      this.ternary();
      if (this.pos !== this.tokens.length) throw BAIL;
    } catch {
      this.pending.length = 0;
      this.pending.push(...saved);
    }
  }

  private peek(): AuditToken | undefined {
    return this.tokens[this.pos];
  }

  private isOp(text: string): boolean {
    const tok = this.peek();
    return tok !== undefined && tok.t === "op" && tok.text === text;
  }

  private isPunct(text: string): boolean {
    const tok = this.peek();
    return tok !== undefined && tok.t === "punct" && tok.text === text;
  }

  private eatOp(text: string): boolean {
    if (this.isOp(text)) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  private describe(operand: { kind: OperandKind; label: string }): string {
    return `${operand.kind === "unknown" ? "未知类型" : operand.kind}「${operand.label}」`;
  }

  /** 单侧核对：已知操作数必须为 want，否则记警告并返回 true（违规）。note 追加引擎语义注记 */
  private requireKind(
    op: string,
    rule: ExpressionWarning["rule"],
    side: string,
    operand: { kind: OperandKind; label: string } | undefined,
    want: VarKind,
    note = "",
  ): boolean {
    if (operand === undefined || operand.kind === "unknown") return false;
    if (operand.kind === want) return false;
    this.pending.push({
      rule,
      message: `'${op}' ${side}操作数必须为 ${want}——${this.describe(operand)}（引擎 type-error${note}）`,
    });
    return true;
  }

  private ternary(): OperandKind {
    const condKind = this.or();
    if (!this.isPunct("?")) return condKind;
    this.pos += 1;
    const whenTrue = this.ternary();
    if (!this.isPunct(":")) throw BAIL;
    this.pos += 1;
    const whenFalse = this.ternary();
    let violated = false;
    if (condKind !== "unknown" && condKind !== "bool") {
      this.pending.push({
        rule: "ternary-cond-non-bool",
        message: `三元 '?' 条件必须为 boolean（引擎 type-error）——条件${this.describe({ kind: condKind, label: "条件表达式" })}`,
      });
      violated = true;
    }
    if (violated) return "unknown";
    return whenTrue !== "unknown" ? whenTrue : whenFalse;
  }

  private or(): OperandKind {
    let left = this.and();
    while (this.eatOp("||")) {
      const right = this.and();
      const violated =
        this.requireKind(
          "||",
          "logical-non-bool",
          "左",
          { kind: left, label: "左操作数" },
          "bool",
        ) ||
        this.requireKind(
          "||",
          "logical-non-bool",
          "右",
          { kind: right, label: "右操作数" },
          "bool",
          "；右支仅在被求值时检查——'||' 左支为真即短路",
        );
      left = violated ? "unknown" : "bool";
    }
    return left;
  }

  private and(): OperandKind {
    let left = this.equality();
    while (this.eatOp("&&")) {
      const right = this.equality();
      const violated =
        this.requireKind(
          "&&",
          "logical-non-bool",
          "左",
          { kind: left, label: "左操作数" },
          "bool",
        ) ||
        this.requireKind(
          "&&",
          "logical-non-bool",
          "右",
          { kind: right, label: "右操作数" },
          "bool",
          "；右支仅在被求值时检查——'&&' 左支为假即短路",
        );
      left = violated ? "unknown" : "bool";
    }
    return left;
  }

  /** 相等级：至多一个 ==/!=（引擎非链式红线）；仅同类型标量相等 */
  private equality(): OperandKind {
    const left = this.comparison();
    let op: "==" | "!=" | null = null;
    if (this.eatOp("==")) op = "==";
    else if (this.eatOp("!=")) op = "!=";
    if (op === null) return left;
    const right = this.comparison();
    if (left !== "unknown" && right !== "unknown" && left !== right) {
      this.pending.push({
        rule: "equality-kind-mismatch",
        message: `'${op}' 不支持跨类型比较（${left} vs ${right}）——引擎仅同类型标量相等`,
      });
      return "unknown";
    }
    return "bool";
  }

  /** 比较级：至多一个比较符（引擎非链式红线）；只支持 number */
  private comparison(): OperandKind {
    const left = this.additive();
    let op: string | null = null;
    for (const candidate of [">=", "<=", ">", "<"]) {
      if (this.eatOp(candidate)) {
        op = candidate;
        break;
      }
    }
    if (op === null) return left;
    const right = this.additive();
    const violated =
      this.requireKind(
        op,
        "compare-non-num",
        "左",
        { kind: left, label: "左操作数" },
        "num",
      ) ||
      this.requireKind(
        op,
        "compare-non-num",
        "右",
        { kind: right, label: "右操作数" },
        "num",
      );
    return violated ? "unknown" : "bool";
  }

  private additive(): OperandKind {
    let left = this.multiplicative();
    for (;;) {
      const op = this.eatOp("+") ? "+" : this.eatOp("-") ? "-" : null;
      if (op === null) return left;
      const right = this.multiplicative();
      const violated =
        this.requireKind(
          op,
          "arith-non-num",
          "左",
          { kind: left, label: "左操作数" },
          "num",
        ) ||
        this.requireKind(
          op,
          "arith-non-num",
          "右",
          { kind: right, label: "右操作数" },
          "num",
        );
      left = violated ? "unknown" : "num";
    }
  }

  private multiplicative(): OperandKind {
    let left = this.unary();
    for (;;) {
      const op = this.eatOp("*")
        ? "*"
        : this.eatOp("/")
          ? "/"
          : this.eatOp("%")
            ? "%"
            : null;
      if (op === null) return left;
      const right = this.unary();
      const violated =
        this.requireKind(
          op,
          "arith-non-num",
          "左",
          { kind: left, label: "左操作数" },
          "num",
        ) ||
        this.requireKind(
          op,
          "arith-non-num",
          "右",
          { kind: right, label: "右操作数" },
          "num",
        );
      left = violated ? "unknown" : "num";
    }
  }

  private unary(): OperandKind {
    if (this.eatOp("!")) {
      const inner = this.unary();
      if (
        this.requireKind(
          "!",
          "unary-not-non-bool",
          "",
          { kind: inner, label: "操作数" },
          "bool",
        )
      ) {
        return "unknown";
      }
      return "bool";
    }
    if (this.eatOp("-")) {
      const inner = this.unary();
      if (
        this.requireKind(
          "-",
          "unary-minus-non-num",
          "",
          { kind: inner, label: "操作数" },
          "num",
        )
      ) {
        return "unknown";
      }
      return "num";
    }
    return this.primary();
  }

  private primary(): OperandKind {
    const tok = this.peek();
    if (tok === undefined) throw BAIL;
    if (tok.t === "operand") {
      this.pos += 1;
      // 函数调用：ident( … ) ⇒ 结果未知（内置函数参数规则不进本层）
      if (this.isPunct("(")) {
        this.skipBalancedParens();
        return "unknown";
      }
      // 成员路径：ident.ident … ⇒ 结果未知（字典下钻的值型构建期不可知）
      if (this.isPunct(".") && tok.kind === "unknown") {
        while (this.isPunct(".")) {
          this.pos += 1;
          const seg = this.peek();
          if (seg === undefined || seg.t !== "operand") throw BAIL;
          this.pos += 1;
        }
        return "unknown";
      }
      return tok.kind;
    }
    if (tok.t === "punct" && tok.text === "(") {
      this.pos += 1;
      const inner = this.ternary();
      if (!this.isPunct(")")) throw BAIL;
      this.pos += 1;
      return inner;
    }
    throw BAIL;
  }

  /** 括号平衡跳过（函数调用参数整体不判型） */
  private skipBalancedParens(): void {
    let depth = 0;
    for (;;) {
      const tok = this.peek();
      if (tok === undefined) throw BAIL;
      this.pos += 1;
      if (tok.t === "punct") {
        if (tok.text === "(") depth += 1;
        if (tok.text === ")") {
          depth -= 1;
          if (depth === 0) return;
        }
      }
    }
  }
}

/**
 * 表达式标签：`expr\`${vars.player.gold} >= 25\` ⇒ "{player.gold >= 25}"`。
 * 插值规则：VarHandle ⇒ 注册键（未注册抛错）；number/boolean ⇒ 字面量；
 * string ⇒ JSON 字面量（带引号，与引擎字符串字面量口径一致）。
 *
 * 组装同时做轻类型校验（见文件头）：警告进池，由 `drainExpressionWarnings` 取走；
 * 表达式产物与既有行为逐字节一致（校验零侵入）。
 */
export function expr(
  strings: TemplateStringsArray,
  ...parts: unknown[]
): string {
  const registry = currentRegistry;
  if (registry === null) {
    throw new Error("expr 需要先 defineVars（变量注册是表达式句柄的前提）");
  }
  const tokens: AuditToken[] = [];
  const pending: Array<{ rule: ExpressionWarning["rule"]; message: string }> =
    [];
  // 引号状态跨片段/插值跟踪（`"pre${name}post"` 的吞并 footgun：插值会被并进字面量）
  let quote: string | null = null;
  let escaped = false;

  /** 片段词法：引号（跨片段）、双字运算符优先、字面量/数字/标识符；括号与结构标点进流 */
  const lexFragment = (segment: string): void => {
    for (let i = 0; i < segment.length; i += 1) {
      const ch = segment[i]!;
      if (quote !== null) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        tokens.push({ t: "operand", kind: "str", label: "字符串字面量" });
        continue;
      }
      const two = segment.slice(i, i + 2);
      if (
        two === "==" ||
        two === "!=" ||
        two === "&&" ||
        two === "||" ||
        two === ">=" ||
        two === "<="
      ) {
        tokens.push({ t: "op", text: two });
        i += 1;
        continue;
      }
      if ("+-*/%<>!".includes(ch)) {
        tokens.push({ t: "op", text: ch });
        continue;
      }
      if ("(),?:.[]".includes(ch)) {
        tokens.push({ t: "punct", text: ch });
        continue;
      }
      if (/[0-9]/.test(ch)) {
        let j = i;
        while (j < segment.length && /[0-9.]/.test(segment[j]!)) j += 1;
        const literal = segment.slice(i, j);
        i = j - 1;
        tokens.push({ t: "operand", kind: "num", label: literal });
        continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        let j = i;
        while (j < segment.length && /[A-Za-z0-9_]/.test(segment[j]!)) j += 1;
        const word = segment.slice(i, j);
        i = j - 1;
        tokens.push(
          word === "true" || word === "false"
            ? { t: "operand", kind: "bool", label: word }
            : { t: "operand", kind: "unknown", label: word },
        );
        continue;
      }
      // 其余字符（空白等）：词法噪声，不进流
    }
  };

  /** 插值贡献（文本 + 判类）：产物文本与既有行为逐字节一致（校验零侵入） */
  const appendPart = (
    part: unknown,
  ): { text: string; kind: OperandKind; label: string } => {
    if (isVarHandle(part)) {
      const key = varKeyOf(part, registry);
      return { text: key, kind: part.kind, label: `变量 ${key}` };
    }
    if (typeof part === "number" || typeof part === "boolean") {
      return {
        text: String(part),
        kind: typeof part as VarKind,
        label: String(part),
      };
    }
    if (typeof part === "string") {
      return {
        text: JSON.stringify(part),
        kind: "str",
        label: JSON.stringify(part),
      };
    }
    throw new Error(
      `expr 不支持的插值类型：${typeof part}——若是变量句柄，请确认已在 defineVars 注册`,
    );
  };

  let out = "{";
  strings.forEach((segment, i) => {
    lexFragment(segment);
    out += segment;
    if (i >= parts.length) return;
    const part = parts[i];
    if (quote !== null) {
      // 校验零侵入：警告照记，但文本照旧并入产物（与既有行为逐字节一致）
      pending.push({
        rule: "interpolation-inside-string",
        message:
          "插值落在字符串字面量内部（引号未闭合）——插值文本会被并进字面量，不会成为表达式操作数",
      });
      out += appendPart(part).text;
      return;
    }
    const applied = appendPart(part);
    out += applied.text;
    tokens.push({ t: "operand", kind: applied.kind, label: applied.label });
  });

  const finalize = (): string => `${out}}`;
  if (quote !== null) {
    // 字面量到表达式末尾都没闭合：引擎将 parse-error——类型核查无意义，只报这一条
    pending.push({
      rule: "unclosed-string-literal",
      message: "表达式存在未闭合的字符串字面量（引擎将 parse-error）",
    });
    warningSink.push(
      ...pending.map((item) => ({ expression: finalize(), ...item })),
    );
    return finalize();
  }
  new ExpressionAuditor(tokens, pending).audit();
  for (const item of pending) {
    warningSink.push({ expression: finalize(), ...item });
  }
  return finalize();
}

/** `expr` 的别名（条件语境的语义化写法；同一实现、同一校验） */
export const cond = expr;
