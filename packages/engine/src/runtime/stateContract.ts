/**
 * T08-07 / D-42 写入契约守卫（值侧）：进入 SSOT 的值必须 **JSON 安全**。
 *
 * 动机（D-42 的三种真实失败形态，全部曾无守卫）：
 * - `Map`/`Set`/类实例 → `JSON.stringify` 成 `{}` 或抛错 = **静默丢数据 / 写档才抛**；
 * - `Date` → 类型漂移（写档变字符串）；
 * - 循环引用 → `JSON.stringify` 直接抛（写档期才炸，且无定位）；
 * - `NaN`/`Infinity` → 序列化成 `null`（静默变形）。
 *
 * 时机（⚖️ R8 裁定 = 组合式，本模块为「写入时」半边）：
 * - **写入时**（`setGlobal` / `setSystem`）：类型白名单 + 对**新写入值本身**的深走查。
 *   白名单是 O(1)；深走查是 O(新值大小)——循环引用**只能在写入点廉价捕获**（带键名定位、
 *   状态原样），拖到序列化期就只剩"写档才抛"。数组/字典类 op 本就因写时复制而 O(新值) 拷贝，
 *   走查与拷贝同量级，不改变复杂度。
 * - **序列化边界**（`exportSave`）：全量深校验，兜「写后原地改」——写入时契约 + 写时复制
 *   都挡不住作者在拿到引用后原地改值（R8 已裁定这属作者行为，靠契约条款 + 断言工具 +
 *   序列化边界兜底，快照期不做硬门禁）。
 *
 * 键侧（保留键）见 `contracts/runtime.ts` 的 `RESERVED_STATE_KEYS`，守卫在 `engine.setGlobal`。
 */

/**
 * O(1) 白名单：JSON 安全类型 = 标量（string / finite number / boolean / null）/
 * 普通对象（原型为 `Object.prototype` 或 null）/ 数组。
 * 拒绝：`undefined` 值、`function`、`symbol`、`bigint`、非有限数、`Date`、`Map`、`Set`、
 * `RegExp` 及一切类实例（原型非 Object）。
 *
 * @returns 不安全时返回**原因短语**（供错误信息拼接），安全返回 `null`
 */
export function jsonUnsafeReason(value: unknown): string | null {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return null;
    case "number":
      return Number.isFinite(value)
        ? null
        : "非有限数（NaN/Infinity 经 JSON 序列化会变形为 null）";
    case "object":
      break; // 数组 / 普通对象 / 其余对象原型再判
    default:
      return `类型 ${typeof value} 不是 JSON 值`; // undefined / function / symbol / bigint
  }
  if (Array.isArray(value)) return null; // 必须先于原型判定（数组原型是 Array.prototype，合法）
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    const name =
      typeof (proto as { constructor?: { name?: string } }).constructor?.name ===
      "string"
        ? (proto as { constructor: { name: string } }).constructor.name
        : "未知原型";
    return `非普通对象（${name} 实例）`;
  }
  return null;
}

/**
 * 深走查：返回第一个不安全值的**定位路径**（如 `cfg.items[2].x` / `cfg.self`），
 * 全部安全返回 `null`。语义**精确对齐 `JSON.stringify`**，检测三类问题：
 * ① 嵌套值违反白名单（递归套用 `jsonUnsafeReason`）；
 * ② **循环引用**（只把"当前递归路径上的祖先"视为环——兄弟分支共享同一引用是合法别名，
 * `JSON.stringify` 可正常处理，不误报）；
 * ③ **序列化变形点**：数组元素上的 `undefined`/函数/symbol 会变成 `null`（数据变形，拒）；
 * 对象成员上的 `undefined`/函数/symbol 会被 `JSON.stringify` **丢弃**（同语义放行——
 * 这正是 TS 作者可选字段的惯用形态 `{ id, name: undefined }`，不算静默丢数据）。
 *
 * @param root     要校验的值（单次写入的新值，或序列化前的整个状态条目）
 * @param rootName 定位路径的根名（通常 = 写入的键名，恒出现在定位路径里）
 */
export function findJsonValueError(
  root: unknown,
  rootName: string,
): string | null {
  const ancestors = new Set<unknown>();
  const walk = (value: unknown, path: string): string | null => {
    const reason = jsonUnsafeReason(value);
    if (reason !== null) return `${path}：${reason}`;
    if (value === null || typeof value !== "object") return null;
    if (ancestors.has(value)) return `${path}：循环引用`;
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
          const hit = walk(value[index], `${path}[${index}]`);
          if (hit !== null) return hit;
        }
        return null;
      }
      for (const [key, item] of Object.entries(value)) {
        // JSON.stringify 丢弃这三类对象成员（键直接消失）→ 同语义放行，不往下走
        if (
          item === undefined ||
          typeof item === "function" ||
          typeof item === "symbol"
        ) {
          continue;
        }
        const hit = walk(item, `${path}.${key}`);
        if (hit !== null) return hit;
      }
      return null;
    } finally {
      ancestors.delete(value); // 回溯：只把递归路径上的节点当祖先
    }
  };
  return walk(root, rootName);
}
