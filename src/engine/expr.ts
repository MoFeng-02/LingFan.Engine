/**
 * 04-表达式求值（语法：01 §三 + 老 JSON故事格式_V1 §七；语义：04 §二）。
 * 求值时机 = 执行期；动态类型 number/boolean/string/数组/字典；
 * fail-closed：类型错误、未知变量/函数、除零 → ExpressionError（S5，不静默 NaN）。
 * 硬红线：比较运算符非链式（S4）；&&/|| 短路（S7）；转义未知保留两字符（F4）。
 */
import type { NameResolver } from "./resolver";

export type { NameResolver } from "./resolver";

/** 04 §二.2 值域（吸收灵泛）：number / boolean / string / 数组 / 字典（interface 落点支持递归） */
export interface ExprDict {
  [key: string]: ExprValue;
}

export type ExprValue = number | boolean | string | ExprValue[] | ExprDict;

export type ExpressionErrorCode =
  | "parse-error"
  | "non-chained-comparison"
  | "type-error"
  | "unknown-variable"
  | "unknown-function"
  | "arity-error"
  | "invalid-range"
  | "division-by-zero";

export class ExpressionError extends Error {
  constructor(
    readonly code: ExpressionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ExpressionError";
  }
}

// —— 词法 ——

interface Token {
  kind: "num" | "str" | "ident" | "op" | "eof";
  text: string;
  value?: number | string;
}

const TWO_CHAR_OPS = ["==", "!=", ">=", "<=", "&&", "||"];
const ONE_CHAR_OPS = [
  ">",
  "<",
  "!",
  "?",
  ":",
  "+",
  "-",
  "*",
  "/",
  "%",
  "(",
  ")",
  ",",
  ".",
];

/** F4：已知转义映射；未知转义保留两字符原样（Windows 路径兼容） */
const ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  '"': '"',
  "\\": "\\",
};

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const isDigit = (c: string) => c >= "0" && c <= "9";
  const isIdentStart = (c: string) => /[A-Za-z_\u4e00-\u9fa5]/.test(c);
  const isIdentPart = (c: string) => /[A-Za-z0-9_\u4e00-\u9fa5]/.test(c);

  while (i < src.length) {
    const ch = src[i]!;
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i += 1;
      continue;
    }
    if (isDigit(ch)) {
      let j = i + 1;
      while (j < src.length && isDigit(src[j]!)) j += 1;
      if (src[j] === "." && j + 1 < src.length && isDigit(src[j + 1]!)) {
        j += 2;
        while (j < src.length && isDigit(src[j]!)) j += 1;
      }
      const text = src.slice(i, j);
      tokens.push({ kind: "num", text, value: Number(text) });
      i = j;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let out = "";
      let closed = false;
      while (j < src.length) {
        const c = src[j]!;
        if (c === '"') {
          closed = true;
          j += 1;
          break;
        }
        if (c === "\\") {
          const next = src[j + 1];
          if (next === undefined)
            throw new ExpressionError("parse-error", "字符串转义不完整");
          out += ESCAPES[next] ?? `\\${next}`; // F4：未知转义保留两字符
          j += 2;
          continue;
        }
        out += c;
        j += 1;
      }
      if (!closed) throw new ExpressionError("parse-error", "字符串未闭合");
      tokens.push({ kind: "str", text: src.slice(i, j), value: out });
      i = j;
      continue;
    }
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < src.length && isIdentPart(src[j]!)) j += 1;
      tokens.push({ kind: "ident", text: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.includes(two)) {
      tokens.push({ kind: "op", text: two });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.includes(ch)) {
      tokens.push({ kind: "op", text: ch });
      i += 1;
      continue;
    }
    throw new ExpressionError(
      "parse-error",
      `无法识别的字符：${JSON.stringify(ch)}`,
    );
  }
  tokens.push({ kind: "eof", text: "" });
  return tokens;
}

// —— 语法与求值（求值闭包：短路要求右支惰性） ——

type Thunk = () => ExprValue;

const COMPARISON_OPS = new Set([">", "<", ">=", "<="]);
const EQUALITY_OPS = new Set(["==", "!="]);

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly resolve: NameResolver,
    private readonly rng: () => number = Math.random,
  ) {}

  private peek(): Token {
    return this.tokens[Math.min(this.pos, this.tokens.length - 1)]!;
  }

  private matchOp(text: string): boolean {
    const t = this.peek();
    if (t.kind === "op" && t.text === text) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  private expectOp(text: string): void {
    if (!this.matchOp(text)) {
      throw new ExpressionError(
        "parse-error",
        `期望 '${text}'，遇到 '${this.peek().text || "结尾"}'`,
      );
    }
  }

  parse(): Thunk {
    const expr = this.ternary();
    const t = this.peek();
    if (t.kind !== "eof") {
      throw new ExpressionError(
        "parse-error",
        `表达式存在多余内容：'${t.text}'`,
      );
    }
    return expr;
  }

  /** 优先级链（04 §二.3）：?: → || → && → ==/!= → 比较 → + - → * / % → 一元 → 成员 */
  private ternary(): Thunk {
    const cond = this.or();
    if (!this.matchOp("?")) return cond;
    const whenTrue = this.ternary();
    this.expectOp(":");
    const whenFalse = this.ternary();
    return () => {
      const c = cond();
      if (typeof c !== "boolean") {
        throw new ExpressionError("type-error", "三元 '?' 条件必须为 boolean");
      }
      return c ? whenTrue() : whenFalse();
    };
  }

  private or(): Thunk {
    let left = this.and();
    while (this.matchOp("||")) {
      const l = left;
      const right = this.and();
      left = () => {
        const v = l();
        if (typeof v !== "boolean") {
          throw new ExpressionError("type-error", "'||' 操作数必须为 boolean");
        }
        if (v) return true; // S7：短路，右支不求值
        const r = right();
        if (typeof r !== "boolean") {
          throw new ExpressionError("type-error", "'||' 操作数必须为 boolean");
        }
        return r;
      };
    }
    return left;
  }

  private and(): Thunk {
    let left = this.equality();
    while (this.matchOp("&&")) {
      const l = left;
      const right = this.equality();
      left = () => {
        const v = l();
        if (typeof v !== "boolean") {
          throw new ExpressionError("type-error", "'&&' 操作数必须为 boolean");
        }
        if (!v) return false; // S7：短路，右支不求值
        const r = right();
        if (typeof r !== "boolean") {
          throw new ExpressionError("type-error", "'&&' 操作数必须为 boolean");
        }
        return r;
      };
    }
    return left;
  }

  /** 相等级：至多一个 ==/!=；同级再遇 ==/!= = 非链式红线（S4） */
  private equality(): Thunk {
    const left = this.comparison();
    let op: "==" | "!=" | null = null;
    if (this.matchOp("==")) op = "==";
    else if (this.matchOp("!=")) op = "!=";
    if (op === null) return left;
    const right = this.comparison();
    const after = this.peek();
    if (after.kind === "op" && EQUALITY_OPS.has(after.text)) {
      throw new ExpressionError(
        "non-chained-comparison",
        `比较运算符非链式（S4 红线）：'${op}' 后又出现 '${after.text}'`,
      );
    }
    if (op === "==") return () => this.equals(left(), right());
    return () => !this.equals(left(), right());
  }

  /** 比较级：至多一个比较符；同级再遇比较符 = 非链式红线（S4） */
  private comparison(): Thunk {
    const left = this.additive();
    let op: string | null = null;
    for (const candidate of [">=", "<=", ">", "<"]) {
      if (this.matchOp(candidate)) {
        op = candidate;
        break;
      }
    }
    if (op === null) return left;
    const right = this.additive();
    const after = this.peek();
    if (after.kind === "op" && COMPARISON_OPS.has(after.text)) {
      throw new ExpressionError(
        "non-chained-comparison",
        `比较运算符非链式（S4 红线）：'${op}' 后又出现 '${after.text}'`,
      );
    }
    return () => {
      const a = left();
      const b = right();
      if (typeof a !== "number" || typeof b !== "number") {
        throw new ExpressionError("type-error", `比较 '${op}' 只支持 number`);
      }
      switch (op) {
        case ">":
          return a > b;
        case "<":
          return a < b;
        case ">=":
          return a >= b;
        default:
          return a <= b;
      }
    };
  }

  private additive(): Thunk {
    let left = this.multiplicative();
    for (;;) {
      const op = this.matchOp("+") ? "+" : this.matchOp("-") ? "-" : null;
      if (op === null) return left;
      const l = left;
      const r = this.multiplicative();
      left = () => {
        const a = l();
        const b = r();
        if (typeof a !== "number" || typeof b !== "number") {
          throw new ExpressionError(
            "type-error",
            `'${op}' 只支持 number（文本拼接请用模板插值）`,
          );
        }
        return op === "+" ? a + b : a - b;
      };
    }
  }

  private multiplicative(): Thunk {
    let left = this.unary();
    for (;;) {
      const op = this.matchOp("*")
        ? "*"
        : this.matchOp("/")
          ? "/"
          : this.matchOp("%")
            ? "%"
            : null;
      if (op === null) return left;
      const l = left;
      const r = this.unary();
      left = () => {
        const a = l();
        const b = r();
        if (typeof a !== "number" || typeof b !== "number") {
          throw new ExpressionError("type-error", `'${op}' 只支持 number`);
        }
        if ((op === "/" || op === "%") && b === 0) {
          throw new ExpressionError(
            "division-by-zero",
            `'${op}' 除数为 0（S5 不静默 NaN）`,
          );
        }
        return op === "*" ? a * b : op === "/" ? a / b : a % b;
      };
    }
  }

  private unary(): Thunk {
    if (this.matchOp("!")) {
      const inner = this.unary();
      return () => {
        const v = inner();
        if (typeof v !== "boolean") {
          throw new ExpressionError("type-error", "'!' 操作数必须为 boolean");
        }
        return !v;
      };
    }
    if (this.matchOp("-")) {
      const inner = this.unary();
      return () => {
        const v = inner();
        if (typeof v !== "number") {
          throw new ExpressionError(
            "type-error",
            "一元 '-' 操作数必须为 number",
          );
        }
        return -v;
      };
    }
    return this.primary();
  }

  private primary(): Thunk {
    const t = this.peek();
    if (t.kind === "num") {
      this.pos += 1;
      const v = t.value as number;
      return () => v;
    }
    if (t.kind === "str") {
      this.pos += 1;
      const v = t.value as string;
      return () => v;
    }
    if (t.kind === "ident") {
      if (t.text === "true" || t.text === "false") {
        this.pos += 1;
        const v = t.text === "true";
        return () => v;
      }
      const name = t.text;
      this.pos += 1;
      if (this.matchOp("(")) {
        const args: Thunk[] = [];
        if (!this.matchOp(")")) {
          for (;;) {
            args.push(this.ternary());
            if (this.matchOp(")")) break;
            this.expectOp(",");
          }
        }
        return () =>
          callBuiltin(
            name,
            args.map((a) => a()),
            this.rng,
          );
      }
      // 成员路径 ident('.'ident)*：点路径 = 全局键路径/字典下钻（04 §二.9），查法由 resolver 决定
      let path = name;
      while (this.matchOp(".")) {
        const seg = this.peek();
        if (seg.kind !== "ident") {
          throw new ExpressionError(
            "parse-error",
            `成员访问 '.' 后必须是名称，遇到 '${seg.text || "结尾"}'`,
          );
        }
        this.pos += 1;
        path += `.${seg.text}`;
      }
      return () => {
        const hit = this.resolve(path);
        if (!hit.found)
          throw new ExpressionError("unknown-variable", `未定义变量：${path}`);
        return hit.value as ExprValue;
      };
    }
    if (t.kind === "op" && t.text === "(") {
      this.pos += 1;
      const inner = this.ternary();
      this.expectOp(")");
      return inner;
    }
    throw new ExpressionError(
      "parse-error",
      `意外的标记：'${t.text || "结尾"}'`,
    );
  }

  private equals(a: ExprValue, b: ExprValue): boolean {
    return exprEquals(a, b);
  }
}

/** ==/!= 的类型规则（switch 复用）：仅同类型标量比较，否则 type-error（S5） */
export function exprEquals(a: ExprValue, b: ExprValue): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (typeof a === "string" && typeof b === "string") return a === b;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b;
  throw new ExpressionError(
    "type-error",
    `'=='/'!=' 不支持跨类型或复合类型比较（${typeof a} vs ${typeof b}）`,
  );
}

/** 04 §二.6 内置函数全集：random（含端点）/ min / max / abs / clamp；random 经注入的 rng 取值（03-R6 确定性：rngState 进快照） */
function callBuiltin(
  name: string,
  args: ExprValue[],
  rng: () => number,
): ExprValue {
  const numbers = (n: number): number[] => {
    if (args.length !== n) {
      throw new ExpressionError(
        "arity-error",
        `${name} 需要 ${n} 个参数，收到 ${args.length}`,
      );
    }
    return args.map((a) => {
      if (typeof a !== "number") {
        throw new ExpressionError("type-error", `${name} 参数必须为 number`);
      }
      return a;
    });
  };
  switch (name) {
    case "random": {
      const [lo, hi] = numbers(2);
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
        throw new ExpressionError("type-error", "random 参数必须为整数");
      }
      if (lo > hi)
        throw new ExpressionError("invalid-range", "random 下界必须 ≤ 上界");
      return lo + Math.floor(rng() * (hi - lo + 1)); // 含端点
    }
    case "min": {
      const [a, b] = numbers(2);
      return Math.min(a, b);
    }
    case "max": {
      const [a, b] = numbers(2);
      return Math.max(a, b);
    }
    case "abs": {
      const [a] = numbers(1);
      return Math.abs(a);
    }
    case "clamp": {
      const [v, lo, hi] = numbers(3);
      return Math.min(Math.max(v, lo), hi);
    }
    default:
      throw new ExpressionError(
        "unknown-function",
        `未知函数：${name}（可用：random/min/max/abs/clamp）`,
      );
  }
}

/** 求值入口：解析 + 求值一步完成（求值时机 = 执行到它的时刻，04 §二.1）；rng 缺省 Math.random（引擎注入确定性 rng） */
export function evaluateExpression(
  src: string,
  resolve: NameResolver,
  rng: () => number = Math.random,
): ExprValue {
  const tokens = tokenize(src);
  if (tokens[0]?.kind === "eof")
    throw new ExpressionError("parse-error", "表达式为空");
  return new Parser(tokens, resolve, rng).parse()();
}

// —— 文本插值（01 §三.4/§三.6、04 §二.8、S8/F7） ——

/** 行内富文本标记（老引擎 DslInlineTags 单一真相源照搬）：这些 {…} 原样透传给渲染层 */
const INLINE_SHORT_TAGS = new Set([
  "b",
  "/b",
  "i",
  "/i",
  "u",
  "/u",
  "w",
  "fast",
  "p",
  "color",
  "font",
  "size", // 裸标签名（用户可能写 {color} 作为闭合）
]);
const INLINE_PREFIXED_TAGS = [
  "color=",
  "/color",
  "font=",
  "/font",
  "size=",
  "/size",
];

function isInlineTag(content: string): boolean {
  if (INLINE_SHORT_TAGS.has(content)) return true;
  return INLINE_PREFIXED_TAGS.some((p) => content.startsWith(p));
}

export interface TextInterpolation {
  text: string;
  errors: ExpressionError[];
}

/**
 * 文本插值：{expr} 求值替换、{expr:format} 格式化（F7：仅文本命令走此路径）；
 * 行内标记原样透传；插值失败保留原文片段 + 收集错误（S8）。
 * 格式符语义（老 ExpressionParser.ApplyFormat 照搬）：全 0 → 按位数补零；X/x → 十六进制；其余原样。
 */
export function interpolateText(
  text: string,
  resolve: NameResolver,
  rng: () => number = Math.random,
): TextInterpolation {
  if (!text.includes("{")) return { text, errors: [] };
  let out = "";
  const errors: ExpressionError[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch !== "{") {
      out += ch;
      i += 1;
      continue;
    }
    const end = text.indexOf("}", i);
    if (end < 0) {
      out += text.slice(i);
      break;
    }
    const content = text.slice(i + 1, end).trim();
    // 格式后缀拆分：{mins:00} → expr=mins, format=00；含 '?'（三元）不拆（老实现规则）
    let exprSrc = content;
    let format: string | null = null;
    if (!content.includes("?")) {
      const colon = content.indexOf(":");
      if (colon > 0) {
        format = content.slice(colon + 1).trim();
        exprSrc = content.slice(0, colon).trim();
      }
    }
    try {
      out += applyFormat(evaluateExpression(exprSrc, resolve, rng), format);
    } catch (e) {
      if (e instanceof ExpressionError) {
        if (isInlineTag(content)) {
          // 冲突裁定：已定义变量 > 行内标记（{i} 在 i 未定义时是斜体标记，已定义时是变量）
          out += text.slice(i, end + 1);
        } else {
          errors.push(e);
          out += text.slice(i, end + 1); // S8：保留原文片段
        }
      } else {
        throw e;
      }
    }
    i = end + 1;
  }
  return { text: out, errors };
}

function applyFormat(value: ExprValue, format: string | null): string {
  let s: string;
  if (typeof value === "number") s = String(value);
  else if (typeof value === "boolean") s = value ? "true" : "false";
  else if (typeof value === "string") s = value;
  else throw new ExpressionError("type-error", "文本插值不支持数组/字典值");
  if (format === null || typeof value !== "number" || !Number.isInteger(value))
    return s;
  if (/^0+$/.test(format)) return s.padStart(format.length, "0");
  if (format === "X") return value < 0 ? s : value.toString(16).toUpperCase();
  if (format === "x") return value < 0 ? s : value.toString(16);
  return s; // 未知格式符原样（老实现兜底语义）
}
