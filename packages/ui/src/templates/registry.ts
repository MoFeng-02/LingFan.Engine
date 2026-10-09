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

/** 模板函数：吃宿主投影出的渲染状态，吐该挂点的内容与根皮肤类（纯函数，不碰 DOM、无副作用） */
export type TemplateFn<TInput, TView extends TemplateViewBase> = (
  input: TInput,
) => TView;

/**
 * 模板注册与解析：按名存模板，解析时未知名 / null / 空串一律回退默认，未设默认则返回 `null`。
 *
 * 用法：宿主装配期 `register` 一批模板（可指定其中之一为兜底），渲染挂载点时用 `resolve` 取函数。
 * 模板缺失不算错误——由宿主的内建实现兜底，因此本表是 fail-soft 的。
 * 本类不持有渲染状态，同一实例可跨挂载点共享。
 */
export class TemplateRegistry<
  TInput,
  TView extends TemplateViewBase,
> {
  private readonly templates = new Map<string, TemplateFn<TInput, TView>>();
  /** 默认模板名（`register` 传 `makeDefault: true` 时改成它）；`null` = 未设默认，解析时返回 `null` */
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

  /** 该名是否已被注册（**不走回退**：问的是表里有没有这个名字） */
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

/** 造一张空的模板注册表（未设默认）；默认模板需在 `register` 时用 `makeDefault: true` 指定 */
export function createTemplateRegistry<
  TInput,
  TView extends TemplateViewBase,
>(): TemplateRegistry<TInput, TView> {
  return new TemplateRegistry<TInput, TView>();
}
