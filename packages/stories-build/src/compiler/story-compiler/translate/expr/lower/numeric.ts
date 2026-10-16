/**
 * 数字与优先级的构建期处理：运算符优先级表、按优先级加括号、数字字面量折叠。
 *
 * 折叠只处理「两侧都是数字字面量」的算术式；除/模零不折叠，留给运行期文法校验（fail-closed）。
 */
export const PRECEDENCE: Record<string, number> = {
  "||": 2,
  "??": 1,
  "&&": 3,
  "==": 4,
  "!=": 4,
  "<": 5,
  ">": 5,
  "<=": 5,
  ">=": 5,
  "+": 6,
  "-": 6,
  "*": 7,
  "/": 7,
  "%": 7,
};

export function wrapOperand(
  child: string,
  childPrec: number,
  parentPrec: number,
): string {
  return childPrec < parentPrec ? `(${child})` : child;
}

const NUMERIC_TEXT = /^-?\d+(?:\.\d+)?$/;

/** 两侧均为数字字面量的算术二元式在构建期折叠成单值（除/模零不折叠，留给运行期文法校验）。 */
export function foldNumericBinary(
  left: string,
  right: string,
  op: string,
): string | undefined {
  if (!NUMERIC_TEXT.test(left) || !NUMERIC_TEXT.test(right)) return undefined;
  const a = Number(left);
  const b = Number(right);
  switch (op) {
    case "+":
      return String(a + b);
    case "-":
      return String(a - b);
    case "*":
      return String(a * b);
    case "/":
      return b === 0 ? undefined : String(a / b);
    case "%":
      return b === 0 ? undefined : String(a % b);
    default:
      return undefined;
  }
}
