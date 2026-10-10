/**
 * JSON Pointer（RFC 6901）的拼装工具：转义单段、拼出整串。
 *
 * 为什么放在共享层：诊断、结构校验、步骤布局都要产出指向 Story 树的 pointer，
 * 契约层只声明「pointer 是一个字符串」，拼法本身是可执行逻辑。
 * 规则只有这一处实现——改口径则全部消费方同步，不会出现半套转义。
 */

/**
 * 转义 JSON Pointer 的单段：`~` 写 `~0`，`/` 写 `~1`。
 *
 * 顺序要紧：必须先替换 `~`。反过来的话，先产出的 `~1` 会被随后的 `~` 替换
 * 二次转义成 `~01`，解析回去得到的是另一条路径。
 */
export function escapePointerToken(token: string | number): string {
  return String(token).replaceAll("~", "~0").replaceAll("/", "~1");
}

/** 由段序列组装 JSON Pointer：没有段即根（空串），否则每段前加 `/` 并逐段转义 */
export function joinPointer(...segments: (string | number)[]): string {
  if (segments.length === 0) return "";
  return "/" + segments.map(escapePointerToken).join("/");
}
