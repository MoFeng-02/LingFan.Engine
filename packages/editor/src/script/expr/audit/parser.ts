/**
 * 表达式审计：把装配时产出的 token 流按引擎的类型规则判类，违规记入警告池。
 *
 * 判类器是一个整体（方法共享游标 `pos` 与警告池），所以实现文件刻意只留一条导入。
 */

import { BAIL, type AuditToken, type ExpressionWarning, type OperandKind, type VarKind } from "./token";

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
export class ExpressionAuditor {
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
