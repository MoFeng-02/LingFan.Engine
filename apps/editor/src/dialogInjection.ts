/**
 * 对话框端口的**注入键**（组合根 → 视图族）。
 *
 * 为什么用 provide/inject 而不是 props 下钻：原生对话框散在
 * `ColumnList` / `NodeGraph` 深处（各自 2~3 处），下钻 props 会把每个组件的
 * 签名都污染；provide/inject 与既有 `editorApi` 同款，组件零 adapters import。
 */
import { inject, type InjectionKey } from "vue";
import type { DialogPort } from "./dialog";

export const DIALOG_PORT_KEY: InjectionKey<DialogPort> = Symbol("lingfan-editor-dialog-port");

/** 取对话框端口；宿主未装配时**静默降级**为「取消一切」的桩（不崩、不假装能问） */
export function useDialog(): DialogPort {
  return (
    inject(DIALOG_PORT_KEY, undefined) ?? {
      // 未装配（单测/独立组件复用）：一律「取消」⇒ 调用方的 `if (!ok) return` 兜住
      askText: async () => null,
      askConfirm: async () => false,
      notify: async () => undefined,
    }
  );
}
