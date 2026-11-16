/**
 * UI 域 op 负载：mount（挂载 / 卸载 UI 组件）。
 *
 * 负载用 type 别名（对象字面量带隐式索引签名，CommandOf 产物可赋给
 * StoryCommand 的开放索引签名）；域 map 用 interface。name 是 UI 目录名
 * （短 id：小写字母开头，其后小写字母 / 数字 / _ / -，与引擎侧 UI_NAME_PATTERN
 * 同形态，正则归 editor 校验器）；props 只收对象，键值是否 JSON 安全由运行期
 * 写入点判定（schema 看不见值语义）。
 */

/** mount：挂载 / 卸载 UI 组件（visible 必填，显隐写死才能让回溯读到确定终值） */
export type MountOpPayload = {
  name: string;
  visible: boolean;
  props?: Record<string, unknown>;
};

export interface UiPayloadMap {
  mount: MountOpPayload;
}
