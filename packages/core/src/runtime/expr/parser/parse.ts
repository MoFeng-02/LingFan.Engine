/**
 * 语法与求值：递归下降解析的优先级阶梯与入口，产出求值闭包（短路要求右支惰性）。
 *
 * 优先级链：?: → ?? → || → && → ==/!= → 比较 → + - → * / % → 一元 → 成员。
 * 硬性约束：比较运算符不可链式。
 * 基本项与一元在 atoms.ts，标记游标在 cursor.ts；本层只做优先级分组。
 */
import { ExpressionError } from "../value.ts";
import { ExprAtomParser } from "./atoms.ts";
import type { Thunk } from "./cursor.ts";

/** 比较运算符集（`<` `<=` `>` `>=`）；比较层非链式 */
const COMPARISON_OPS = new Set([">", "<", ">=", "<="]);
/** 相等运算符集（`==` `!=`）；与比较层分属两层优先级 */
const EQUALITY_OPS = new Set(["==", "!="]);

/**
 * 递归下降解析器：把标记序列解析成求值闭包（Thunk），解析期不取值。
 * 每层只消费自己优先级的运算符；类型错误推迟到闭包执行时才抛 ExpressionError，
 * 所以类型检查是执行期的（fail-closed），常量表达式也一样会走到检查。
 */
export class Parser extends ExprAtomParser {
  /** 入口：解析一条完整表达式，并要求一直消费到 eof（尾部还有标记即 parse-error） */
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

  /** 三元 `?:`（右结合）：条件必须为 boolean，且只对选中的那一支求值。条件侧为 nullish（`??` 优先级高于三元） */
  protected ternary(): Thunk {
    const cond = this.nullish();
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

  /** `||`：两侧都必须为 boolean；左侧为 true 时右支不求值（短路，右支错误不会暴露）。优先级低于 `??` */
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

  /**
   * `??`：左结合（a ?? b ?? c = (a ?? b) ?? c）；左侧为 null/undefined 时取右侧，
   * 否则不求值右支（短路）。优先级同 JS：低于 || 与 &&、高于三元，左结合短路；
   * 与 JS 的差异是 JS 禁止 ?? 与 ||/&& 无括号混用，引擎按优先级直接分组
   * （如 flag ?? false || true = flag ?? (false || true)，左支非空短路）。
   */
  private nullish(): Thunk {
    let left = this.or();
    while (this.matchOp("??")) {
      const l = left;
      const right = this.or();
      left = () => {
        const v = l();
        if (v === null || v === undefined) return right();
        return v;
      };
    }
    return left;
  }

  /** `&&`：两侧都必须为 boolean；左侧为 false 时右支不求值（短路） */
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

  /** 相等级：至多一个 ==/!=；同级再遇 ==/!= 即违反非链式约束 */
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

  /** 比较级：至多一个比较符；同级再遇比较符即违反非链式约束 */
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

  /** 加减：只接受 number；文本拼接不走这里，请用模板插值（不做隐式字符串化） */
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

  /** 乘除模：只接受 number；除数为 0 抛 division-by-zero（不静默产出 NaN/Infinity） */
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
}
