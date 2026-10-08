/**
 * 元素解析与装载（纯函数，可测）。
 *
 * 职责边界：本模块只做**形状校验**与**归一化装载**，不做渲染（UI 层）、
 * 不碰平台（adapters）。scene 列的 `elements[]` 经这里校验后装载为 `ElementInstance[]`
 * 写入 `SYS.elements`（运行期，见 runtime/engine.ts）。
 *
 * 校验口径（fail-closed）：未知类型、未知属性、非法结构一律**整次拒绝**
 * （与 `format.ts` 的 StoryFormatError 同一风格：收集 issues 后一次抛出）。
 */

import {
  ELEMENT_ATTRIBUTES,
  ELEMENT_CONTAINER_TYPES,
  ELEMENT_STRUCTURAL_FIELDS,
  isElementType,
  type ElementInstance,
  type ElementNode,
} from "../contracts";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 可选标识字段校验（缺省合法；存在则必须为非空字符串） */
function validateOptionalName(
  value: unknown,
  at: string,
  field: string,
  issues: string[],
): void {
  if (value === undefined) return;
  if (typeof value !== "string" || value === "") {
    issues.push(`${at}.${field} 必须为非空字符串`);
  }
}

/**
 * **单节点**校验（不递归 `children`）。
 *
 * 编辑器逐节点遍历元素树时用这个（配套 `walkStoryElements`），否则与 `validateElement`
 * 的递归叠加会**双报**同一子元素问题。返回 false 表示该节点结构非法。
 */
export function validateElementNode(
  node: unknown,
  at: string,
  issues: string[],
): boolean {
  if (!isPlainObject(node)) {
    issues.push(`${at} 必须为对象`);
    return false;
  }
  if (!isElementType(node.type)) {
    issues.push(
      `${at}.type 必须是 36 种元素类型之一，收到 ${JSON.stringify(node.type)}（未知类型 fail-closed）`,
    );
    return false;
  }
  const type = node.type;
  validateOptionalName(node.id, at, "id", issues);
  validateOptionalName(node.name, at, "name", issues);

  const children = node.children;
  if (children !== undefined) {
    if (!ELEMENT_CONTAINER_TYPES.has(type)) {
      issues.push(
        `${at}.children 仅容器类型可带（${type} 不是容器：ELEMENT_CONTAINER_TYPES）`,
      );
    } else if (!Array.isArray(children)) {
      issues.push(`${at}.children 必须为数组`);
    }
  }

  for (const key of Object.keys(node)) {
    if (ELEMENT_STRUCTURAL_FIELDS.has(key)) continue;
    if (!ELEMENT_ATTRIBUTES.has(key)) {
      issues.push(
        `${at}.${key} 不是合法元素属性（属性全集 = 通用属性 ∪ 元素特定属性，未知 fail-closed）`,
      );
    }
  }
  // `ops`（点击动作序列）形态校验：非空数组、每项为对象且 `op` 非空字符串。
  // 解析期拒绝 = 编辑器/CLI 立刻可见（运行时才炸的负载不进包）；
  // 具体 op 是否可执行归执行期（等待/位置类 op 由 runElementOps 拒绝，规则只写一处）。
  if (node.ops !== undefined) {
    const ops = node.ops;
    if (!Array.isArray(ops) || ops.length === 0) {
      issues.push(`${at}.ops 必须为非空数组（点击动作序列）`);
    } else {
      for (const [i, item] of ops.entries()) {
        if (!isPlainObject(item)) {
          issues.push(`${at}.ops[${i}] 必须为对象`);
          continue;
        }
        if (typeof item.op !== "string" || item.op === "") {
          issues.push(`${at}.ops[${i}] 缺少非空 op 字符串`);
        }
      }
    }
  }
  // `disabled` 可写布尔或表达式字符串（其余类型 fail-closed）
  if (
    node.disabled !== undefined &&
    typeof node.disabled !== "boolean" &&
    typeof node.disabled !== "string"
  ) {
    issues.push(`${at}.disabled 必须为布尔或表达式字符串`);
  }
  return true;
}

/**
 * 单元素节点校验（**含 `children` 递归**）——引擎解析链用（`format.ts` 的 scene 列校验）。
 * 返回 false 表示该节点结构非法（调用方应中止装载）。
 */
export function validateElement(
  node: unknown,
  at: string,
  issues: string[],
): boolean {
  if (!validateElementNode(node, at, issues)) return false;
  if (!isPlainObject(node)) return false;
  const children = node.children;
  if (Array.isArray(children)) {
    for (const [i, child] of children.entries()) {
      validateElement(child, `${at}.children[${i}]`, issues);
    }
  }
  return true;
}

/** `zindex` / `order` 取值为合法叠放序（非负有限数）时返回其值 */
function numericZ(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/**
 * 装载：`ElementNode[]` → `ElementInstance[]`（深度优先，保留声明序）。
 *
 * - `id`：显式 id 优先；缺省派生 `${columnId}#${序号}`（序号为**同层**遍历序，
 *   仅供内部兜底，不作为稳定契约）
 * - `z`：显式 `zindex` > 显式 `order` > 到达序（同层声明下标）——
 *   按 zindex 属性与到达序（数值越小越靠前）语义
 * - `props`：除结构字段（type/id/name/children）外的全部属性副本
 *
 * 入参应已通过 `validateElement`（`parseStory` 阶段 fail-closed）；本函数不做二次校验。
 */
export function loadElements(
  nodes: readonly ElementNode[],
  columnId: string,
): ElementInstance[] {
  return nodes.map((node, index) => {
    const { type, id, name, children, ...rest } = node;
    const instance: ElementInstance = {
      id: id ?? `${columnId}#${index}`,
      type,
      props: rest,
      z: numericZ(rest.zindex) ?? numericZ(rest.order) ?? index,
      children: [],
    };
    if (name !== undefined) instance.name = name;
    if (Array.isArray(children)) {
      instance.children = loadElements(children as ElementNode[], instance.id);
    }
    return instance;
  });
}

/**
 * 寻址（目标解析）：`id` 精确匹配优先，未命中再 `name` 批量匹配。
 * 返回空数组 = 未找到（调用方 fail-closed + engine.error 诊断，不静默）。
 * 递归覆盖 children（容器内子元素同样可被寻址）。
 */
export function findElements(
  elements: readonly ElementInstance[],
  target: string,
): ElementInstance[] {
  const exact: ElementInstance[] = [];
  const byName: ElementInstance[] = [];
  const walk = (list: readonly ElementInstance[]): void => {
    for (const el of list) {
      if (el.id === target) exact.push(el);
      else if (el.name === target) byName.push(el);
      walk(el.children);
    }
  };
  walk(elements);
  return exact.length > 0 ? exact : byName;
}

/**
 * 按目标移除元素（`hide`）：
 * 命中条件 = `id` / `name` / `props.source` 任一，
 * 递归覆盖 children。**未命中不算错误**（hide 幂等）。
 */
export function removeElements(
  elements: readonly ElementInstance[],
  target: string,
): { next: ElementInstance[]; removed: boolean } {
  let removed = false;
  const walk = (list: readonly ElementInstance[]): ElementInstance[] => {
    const kept: ElementInstance[] = [];
    for (const el of list) {
      const hit =
        el.id === target || el.name === target || el.props.source === target;
      if (hit) {
        removed = true;
        continue;
      }
      const children =
        el.children.length > 0 ? walk(el.children) : el.children;
      kept.push(children === el.children ? el : { ...el, children });
    }
    return kept;
  };
  return { next: walk(elements), removed };
}
