/**
 * 挂载点模板注册表（通用形态：语义骨架挂点 + 皮肤类）。
 *
 * 每个渲染挂载点（对话 / 选择 / 通知 / …）都有自己的 `TemplateInput`（宿主投影的渲染状态）
 * 与 `TemplateView`（各挂点内容 + 根皮肤类）。本类只承载**注册与解析语义**，
 * 与具体挂载点无关：
 * - 空名 = 「无模板」哨兵，不可被注册占用（`resolve("")` 始终走默认）
 * - 未知名 / null / undefined = 回退默认（展示层缺失应有兜底）
 * - 未设默认 = `null`（宿主用自己的内建实现兜底）
 *
 * **与元素/小游戏注册表的口径差异**：那些是 `fail-closed`（未知类型/未注册命令不伪造），
 * 本表是 `fail-soft`——模板只影响「长什么样」，缺失回退默认不会伪造语义。
 */
export interface TemplateViewBase {
  /** 根皮肤类（宿主布局类之上叠加） */
  rootClass: string;
}

export type TemplateFn<TInput, TView extends TemplateViewBase> = (
  input: TInput,
) => TView;

export class TemplateRegistry<
  TInput,
  TView extends TemplateViewBase,
> {
  private readonly templates = new Map<string, TemplateFn<TInput, TView>>();
  private defaultName: string | null = null;

  /** 注册模板（同名覆盖更新——注册即生效的可选语义） */
  register(
    name: string,
    fn: TemplateFn<TInput, TView>,
    opts: { makeDefault?: boolean } = {},
  ): void {
    if (name === "") return; // 空名 = 「无模板」哨兵，不可被注册占用
    this.templates.set(name, fn);
    if (opts.makeDefault === true) this.defaultName = name;
  }

  has(name: string): boolean {
    return this.templates.has(name);
  }

  /** 已注册模板名（诊断 / 帮助面板用） */
  names(): string[] {
    return [...this.templates.keys()];
  }

  /** 按名解析：未知名/null/空串回退默认；未设默认 = null（宿主兜底） */
  resolve(name?: string | null): TemplateFn<TInput, TView> | null {
    if (name !== null && name !== undefined && name !== "") {
      const hit = this.templates.get(name);
      if (hit !== undefined) return hit;
    }
    if (this.defaultName === null) return null;
    return this.templates.get(this.defaultName) ?? null;
  }
}

export function createTemplateRegistry<
  TInput,
  TView extends TemplateViewBase,
>(): TemplateRegistry<TInput, TView> {
  return new TemplateRegistry<TInput, TView>();
}
