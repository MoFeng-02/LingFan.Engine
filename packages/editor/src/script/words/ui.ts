/**
 * Script 词汇层 · **挂载 UI**（ui）。
 *
 * 故事源用一行 import 拿到一个 UI 的句柄：
 *
 * ```ts
 * import hub from "../../ui/hub/hub.vue";
 * mount(hub, true);
 * ```
 *
 * 句柄在编译期就退化成一个名字（`"hub"`），运行期没有对象、没有文件加载——
 * 这正是「静态声明」的含义：写 import 只是告诉编译器「这一列会挂哪个 UI」，
 * 真正把 UI 挂上舞台是 `mount` op 在运行期做的事。
 *
 * 本文件是 `UiHandle` 的**唯一声明处**；`@lingfan-engine/stories-build/authoring`
 * 只做类型转发，所以故事源不需要额外的 tsconfig 配置就能拿到同一份形状。
 */
import type { CommandOf } from "../../schema/index.ts";

export interface UiHandle<N extends string = string> {
  readonly face: "uis";
  readonly name: N;
}

/**
 * UI 名注册表（类型扩充点）：生成物 `src/gen/ui_register.g.ts` 尾部
 * `declare module "@lingfan-engine/editor"` 往本接口塞进每个 UI 名的字面量键 ⇒
 * {@link mount} 的名字参数获得补全与写错即红。空表退化为普通 string。
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- 类型扩充点：只有接口可被生成物 declare module 合并（type 别名不能），空体是有意形态
export interface UiNameRegistry {}

/** 已声明 UI 名（有声明 = 字面量联合；空 = string） */
export type KnownUiName = keyof UiNameRegistry extends never
  ? string
  : keyof UiNameRegistry & string;

/**
 * 挂载 / 卸载一个 UI 组件：`mount(hub, true)`、`mount(hub, false)`、
 * `mount(map, true, { scene: "forest" })`。
 *
 * 状态写进 `SYS.mounts`，随快照 / 存档 / 回溯自动随行；宿主按这张表决定
 * 渲染树上有哪些组件。**隐藏 = 从渲染树移除**（卸载组件），不是 `display: none`。
 *
 * @param handle UI 句柄（`import hub from "…/hub.vue"`）或其名字字符串。
 * @param visible 是否挂载。必填：没有「切换」写法，显隐写死才能让回溯读到确定的终值。
 * @param props 传给组件的入参（JSON 安全）。给了就**整份替换**，不与上一次合并——
 *   组件的入参集合是它的契约，得能完整指定（含「删掉一个入参」）。
 * @returns `mount` 故事命令。
 * @example
 * import hub from "../../ui/hub/hub.vue";
 * mount(hub, true);
 * mount(hub, false);
 */
export function mount<const N extends string>(
  handle: UiHandle<N> | KnownUiName,
  visible: boolean,
  props?: Readonly<Record<string, unknown>>,
): CommandOf<"mount"> {
  const name = typeof handle === "string" ? handle : handle.name;
  const cmd: CommandOf<"mount"> = { op: "mount", name, visible };
  if (props !== undefined) cmd.props = { ...props };
  return cmd;
}
