/**
 * 列对象（scene / flow）的形状判定与解析。
 *
 * 形状是否合法是**单一判定点**：`columnShapeDefect` 出缺陷码，各调用点只管把缺陷
 * 渲染成自己那边的定位文案（故事文件里用列路径，组装层用列 id），判定本身不许各写一份。
 * 不改判定、不改文案的分片搬运是安全的；一旦有人把这里的 kind/type 判据另写一份，
 * 两条路径迟早会对同一个文件给出不同结论。
 */
import { isPlainObject } from "../../shared/index.ts";
import {
  findJsonValueError,
  isSceneName,
  isSceneType,
  isUiName,
  normalizeSceneType,
  normalizeUiNames,
  type ColumnBody,
  type ElementNode,
  type SceneType,
  type StoryColumn,
  type StoryCommand,
} from "../../contracts/index.ts";
import { validateElement } from "../element.ts";
import { validateCommand } from "./validate.ts";

/** 单列原子文件形态判定（顶层即列对象：id + kind，无 columns[]） */
export function isSingleColumnFile(json: unknown): boolean {
  return (
    isPlainObject(json) &&
    !Array.isArray(json.columns) &&
    json.kind !== undefined
  );
}

/**
 * 列形状缺陷：只报「哪里不对」，不含定位文案（各调用点自己渲染）。
 */
export type ColumnShapeDefect =
  | { reason: "bad-kind"; received: unknown }
  | { reason: "bad-type"; received: unknown }
  | { reason: "flow-without-commands" }
  | { reason: "scene-without-elements" }
  | { reason: "body-conflict-elements" };

/**
 * 列对象形状判定（缺省校验 `type`）。
 *
 * `type`（运行语义：game/ui）**缺省合法 = game**，但**给了就必须合法**——
 * 非法值 fail-closed（不静默当 game，否则作者以为设了界面层其实是剧情，
 * 那种错要等存档/回溯出问题才发现，代价极高）。
 *
 * 已经另行校验过 `type` 的调用点可传 `checkType: false`，避免同一处报两遍。
 */
export function columnShapeDefect(
  column: Record<string, unknown>,
  options?: { checkType?: boolean },
): ColumnShapeDefect | null {
  const kind = column.kind;
  if (kind !== "scene" && kind !== "flow") {
    return { reason: "bad-kind", received: kind };
  }
  if (
    options?.checkType !== false &&
    column.type !== undefined &&
    !isSceneType(column.type)
  ) {
    return { reason: "bad-type", received: column.type };
  }
  if (kind === "flow") {
    if (!Array.isArray(column.commands))
      return { reason: "flow-without-commands" };
    return null;
  }
  const hasElements = Array.isArray(column.elements);
  // 身体与元素都是「列的整屏画面」：同时声明就是两个渲染器抢同一块画布，
  // 而谁在上没有定义 ⇒ fail-closed（要叠一层用 `mount`，那条路的语义本来就是叠加）。
  if (hasElements && column.body !== undefined) {
    return { reason: "body-conflict-elements" };
  }
  if (!hasElements && column.body === undefined) {
    return { reason: "scene-without-elements" };
  }
  return null;
}

/**
 * 把一段未知 JSON 解析成故事列，形状不合法即拒。
 *
 * 输入：`raw` 待解析的列数据、`at` 定位前缀、`issues` 收集器。
 * 产出：解析成功的 `StoryColumn`；`id` 缺失或形状不合法时返回 `null`。
 * 失败表现：不抛异常，一律把原因（带 `at` 定位）推入 `issues` 后返回 `null`。
 * 形状判定收敛在 `columnShapeDefect`，本函数只负责把缺陷码渲染成既有的用户可见文案。
 */
export function parseColumn(
  raw: unknown,
  at: string,
  issues: string[],
): StoryColumn | null {
  if (!isPlainObject(raw)) {
    issues.push(`${at} 必须为对象`);
    return null;
  }
  if (typeof raw.id !== "string" || raw.id === "") {
    issues.push(`${at}.id 必须为非空字符串`);
    return null;
  }
  const shape = columnShapeDefect(raw);
  if (shape !== null) {
    if (shape.reason === "bad-kind") {
      issues.push(
        `${at}.kind 必须为 "scene" 或 "flow"，收到 ${JSON.stringify(shape.received)}`,
      );
    } else if (shape.reason === "bad-type") {
      issues.push(
        `${at}.type 必须为 "game" / "ui"，收到 ${JSON.stringify(shape.received)}`,
      );
    } else if (shape.reason === "flow-without-commands") {
      issues.push(`${at}（flow）必须有 commands 数组`);
    } else if (shape.reason === "body-conflict-elements") {
      issues.push(
        `${at} 不能同时声明 elements 与 body（二者互斥：elements 由引擎解释，body 由宿主渲染，叠加请用 mount）`,
      );
    } else {
      issues.push(
        `${at}（scene）必须有 elements 数组或 body 声明（二者至少一个）`,
      );
    }
    return null;
  }
  // `type` 已在上面按形状判定过（只接受 `game` / `ui`，其余含旧拼写 `menu` 一律
  // fail-closed 报错），这里只做「缺席 = 不声明」与合法值的归一。归一仍然要调，
  // 因为它是读侧兜底：非法值到不了这一步，但缺省与空值的收敛口径与它同一处。
  // 原拼写要不要留（编辑器展示「菜单」还是「界面」）由编辑器自己收，不进故事树。
  const type: SceneType | undefined =
    raw.type === undefined ? undefined : normalizeSceneType(raw.type);
  const kind = raw.kind as "scene" | "flow";
  // 列级字体：可选元数据，非空字符串才收（注册表校验在构建期/渲染层闸门，解析只管形状）
  let font: string | undefined;
  if (raw.font !== undefined) {
    if (typeof raw.font !== "string" || raw.font === "") {
      issues.push(
        `${at}.font 必须为非空字符串（字体名 = Resources/Fonts 文件名去扩展名）`,
      );
      return null;
    }
    font = raw.font;
  }
  // 列级 UI 声明：可选元数据，字符串数组且每元素是合法 UI 名（目录名形态）。
  // 读入即归一（去重 + 码点序）：产物字节要由数据决定，不能由书写顺序决定。
  // 空数组与缺省等价（`undefined`）——「没有 UI 的列不带该字段」是同一条规则。
  let uis: readonly string[] | undefined;
  if (raw.uis !== undefined) {
    if (!Array.isArray(raw.uis)) {
      issues.push(`${at}.uis 必须为字符串数组（元素是 UI 目录名）`);
      return null;
    }
    for (const [j, name] of raw.uis.entries()) {
      if (!isUiName(name)) {
        issues.push(
          `${at}.uis[${j}] 不是合法 UI 名：收到 ${JSON.stringify(name)}（小写字母开头，其后小写字母 / 数字 / \`_\` / \`-\`，总长 1..32）`,
        );
        return null;
      }
    }
    const normalized = normalizeUiNames(raw.uis as string[]);
    if (normalized.length > 0) uis = normalized;
  }
  // 列身体：可选展示声明。`props` 原样写入 SYS.body、引擎不求值，所以这里只查
  // 「形状对不对」与「JSON 安不安全」——含函数/undefined/循环引用的 props 会静默变形，
  // 属数据损坏，必须在此拦下而不是等到渲染时。
  let body: ColumnBody | undefined;
  if (raw.body !== undefined) {
    if (!isPlainObject(raw.body)) {
      issues.push(`${at}.body 必须为对象`);
      return null;
    }
    const name = raw.body.name;
    if (!isSceneName(name)) {
      issues.push(
        `${at}.body.name 不是合法组件名：收到 ${JSON.stringify(name)}（小写字母开头，其后小写字母 / 数字 / \`_\` / \`-\`，总长 1..32）`,
      );
      return null;
    }
    const rawProps = raw.body.props;
    if (rawProps !== undefined && !isPlainObject(rawProps)) {
      issues.push(`${at}.body.props 必须为对象`);
      return null;
    }
    if (rawProps !== undefined) {
      const unsafe = findJsonValueError(rawProps, `${at}.body.props`);
      if (unsafe !== null) {
        issues.push(
          `${at}.body.props 必须是 JSON 安全值（引擎会原样写入 SYS.body，不做求值）：${unsafe}`,
        );
        return null;
      }
    }
    // props 缺省不带该键（不是空对象）：与 uis / font 的「未引用不写」同规则，
    // 且让产物的摘要对比在热重载前后稳定。
    body =
      rawProps === undefined
        ? { name }
        : { name, props: rawProps as Record<string, unknown> };
  }
  if (kind === "flow") {
    if (!Array.isArray(raw.commands)) {
      issues.push(`${at}（flow）必须有 commands 数组`);
      return null;
    }
    for (const [j, cmd] of raw.commands.entries()) {
      validateCommand(cmd, `${at}.commands[${j}]`, issues);
    }
  } else {
    if (!Array.isArray(raw.elements) && body === undefined) {
      issues.push(
        `${at}（scene）必须有 elements 数组或 body 声明（二者至少一个）`,
      );
      return null;
    }
    const seenElementIds = new Set<string>();
    // 有身体的列可以不带 elements（两者互斥，形状判定已拦同时声明）。
    const elements = Array.isArray(raw.elements) ? raw.elements : [];
    for (const [j, node] of elements.entries()) {
      validateElement(node, `${at}.elements[${j}]`, issues);
      if (
        isPlainObject(node) &&
        typeof node.id === "string" &&
        node.id !== ""
      ) {
        if (seenElementIds.has(node.id)) {
          issues.push(
            `${at}.elements[${j}].id 重复：${node.id}（同列内元素 id 必须唯一，寻址前提）`,
          );
        } else {
          seenElementIds.add(node.id);
        }
      }
    }
    if (raw.entry !== undefined) {
      if (!Array.isArray(raw.entry)) {
        issues.push(`${at}.entry 必须为数组`);
        return null;
      }
      for (const [j, cmd] of raw.entry.entries()) {
        validateCommand(cmd, `${at}.entry[${j}]`, issues);
      }
    }
  }
  return {
    id: raw.id,
    kind,
    type,
    font,
    uis,
    body,
    // `sourcePath` **刻意不解析**：它是编辑期记账（由组装器从实际文件路径回填），
    // 故事文件里不该有这个键——写进去也无效（防止自指：文件描述自己的位置）。
    elements: Array.isArray(raw.elements)
      ? (raw.elements as ElementNode[])
      : undefined,
    entry: raw.entry as StoryCommand[] | undefined,
    commands: raw.commands as StoryCommand[] | undefined,
  };
}
