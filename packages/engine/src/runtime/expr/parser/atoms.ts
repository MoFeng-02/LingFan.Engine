/**
 * 表达式基本项与一元运算：数字、字符串、true/false/null、内建函数调用、成员路径、括号分组，
 * 以及可叠用的 `!` `-`。
 *
 * 为什么是基类：优先级阶梯接在基本项**之上**（见 parse.ts），所以这一层只往「更低」走；
 * 括号分组与函数实参要重新从最低优先级进栈，故把 ternary 声明成抽象方法，
 * 由阶梯层实现——两层因此不必互相 import（避免 import 成环）。
 */
import { callBuiltin } from "../builtins.ts";
import { ExpressionError, exprEquals, type ExprValue } from "../value.ts";
import { ExprCursor, type Thunk } from "./cursor.ts";

/** 基本项与一元运算层：只依赖游标，不依赖优先级阶梯的具体实现 */
export abstract class ExprAtomParser extends ExprCursor {
  /**
   * 括号分组与函数实参要重新从最低优先级进栈。
   * 实现方在优先级阶梯层（parse.ts）；声明成抽象方法是为了让本层能往下调用而不反向 import。
   */
  protected abstract ternary(): Thunk;

  /** 一元 `!` 与 `-`：分别只接受 boolean 与 number，其余抛 type-error；可递归叠用 */
  protected unary(): Thunk {
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

  /**
   * 基本项：数字、字符串、true/false/null、内建函数调用、成员路径、括号分组。
   * 成员路径按 ident('.'ident)* 收成整条点路径，是全局键还是字典下钻由 resolver 决定；
   * 变量未定义时抛 unknown-variable（不回落成 undefined）。
   */
  protected primary(): Thunk {
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
      if (t.text === "null") {
        this.pos += 1;
        return () => null;
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
            this.resolve,
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

  /** `==`/`!=` 的共用比较：委托 exprEquals（跨类型或复合类型比较抛 type-error） */
  protected equals(a: ExprValue, b: ExprValue): boolean {
    return exprEquals(a, b);
  }
}
