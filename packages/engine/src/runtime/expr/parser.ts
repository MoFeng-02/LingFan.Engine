/**
 * 语法与求值：递归下降解析，求值闭包（短路要求右支惰性）。
 *
 * 优先级链：?: → || → && → ==/!= → 比较 → + - → * / % → 一元 → 成员。
 * 硬红线：比较运算符非链式。
 */
import type { NameResolver } from "../resolver";
import { callBuiltin } from "./builtins";
import { ExpressionError, exprEquals, type ExprValue } from "./value";
import type { Token } from "./lexer";

type Thunk = () => ExprValue;

const COMPARISON_OPS = new Set([">", "<", ">=", "<="]);
const EQUALITY_OPS = new Set(["==", "!="]);

export class Parser {
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
        if (v) return true; // 短路，右支不求值
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
        if (!v) return false; // 短路，右支不求值
        const r = right();
        if (typeof r !== "boolean") {
          throw new ExpressionError("type-error", "'&&' 操作数必须为 boolean");
        }
        return r;
      };
    }
    return left;
  }

  /** 相等级：至多一个 ==/!=；同级再遇 ==/!= = 非链式红线 */
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
        `比较运算符非链式：'${op}' 后又出现 '${after.text}'`,
      );
    }
    if (op === "==") return () => this.equals(left(), right());
    return () => !this.equals(left(), right());
  }

  /** 比较级：至多一个比较符；同级再遇比较符 = 非链式红线 */
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
        `比较运算符非链式：'${op}' 后又出现 '${after.text}'`,
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
            `'${op}' 除数为 0（不静默 NaN）`,
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
      // 成员路径 ident('.'ident)*：点路径 = 全局键路径/字典下钻，查法由 resolver 决定
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
