/**
 * 表达式解析游标：标记序列的读取位置，以及运算符的「试探—回退」。
 *
 * 为什么单独一层：优先级阶梯（parse.ts）与基本项（atoms.ts）都要沿同一游标前进/回退，
 * 游标把「只有这里能改 pos」收在一处；peek 在越界时钳到末尾的 eof，
 * 所以上层各层不必各自判边界。
 */
import type { NameResolver } from "../../resolver.ts";
import type { Token } from "../lexer.ts";
import { ExpressionError, type ExprValue } from "../value.ts";

/** 求值闭包：解析期只搭结构，真正取值推迟到闭包被调用时（短路要求右支惰性） */
export type Thunk = () => ExprValue;

/**
 * 游标基类：只负责读标记与试探运算符，不参与优先级分组。
 * 只有子类可用（abstract），直接实例化没有语义。
 */
export abstract class ExprCursor {
  /** 当前标记游标；越界时由 peek 钳到末尾的 eof，不会真越界 */
  protected pos = 0;

  protected readonly tokens: Token[];
  protected readonly resolve: NameResolver;
  protected readonly rng: () => number;

  /**
   * @param tokens 词法器产出的标记序列（约定以 eof 结尾）
   * @param resolve 名称解析器：点路径是全局键还是字典下钻由它决定
   * @param rng 内建随机函数的随机源；注入以便测试复现
   */
  constructor(
    tokens: Token[],
    resolve: NameResolver,
    rng: () => number = Math.random,
  ) {
    this.tokens = tokens;
    this.resolve = resolve;
    this.rng = rng;
  }

  /** 预读当前标记；游标已在末尾时返回最后的 eof（永不越界，也不前进） */
  protected peek(): Token {
    return this.tokens[Math.min(this.pos, this.tokens.length - 1)]!;
  }

  /** 当前标记正好是指定运算符才前进一格并返回 true；否则不动（便于逐级回退试探） */
  protected matchOp(text: string): boolean {
    const t = this.peek();
    if (t.kind === "op" && t.text === text) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  /** 断言下一个标记是指定运算符；不符即抛 parse-error，消息里带上实际遇到的标记 */
  protected expectOp(text: string): void {
    if (!this.matchOp(text)) {
      throw new ExpressionError(
        "parse-error",
        `期望 '${text}'，遇到 '${this.peek().text || "结尾"}'`,
      );
    }
  }
}
