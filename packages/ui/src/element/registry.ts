/**
 * 元素渲染器注册表（UI 层职责）：核心层只声明元素 `type` 与属性，
 * 宿主经注册表解析渲染器后挂载到舞台。
 *
 * 与 minigame 注册表同一纪律：**未知类型无默认回退** = fail-closed
 * ——静默占位会掩盖内容错误（渲染"看得见"，但语义是错的）。
 *
 * 框架无关：本模块只碰 DOM 与回调，不依赖任何 UI 框架（核心只写状态，
 * UI 只渲染；渲染器是宿主可替换的产物）。
 */
import type { ElementInstance } from "@lingfan/engine";

/** 元素渲染上下文：渲染器只消费宿主提供的能力，不直接接触引擎 */
export interface ElementRenderContext {
  /** 元素实例（id/type/name/props/z/children） */
  element: ElementInstance;
  /** 递归渲染子元素（容器渲染器把 children 渲染进给定容器） */
  renderChildren: (container: HTMLElement, children: readonly ElementInstance[]) => void;
  /** 交互激活（判定通过后由渲染器调用；具体 nav/cmd 语义归宿主） */
  activate?: (element: ElementInstance) => void;
  /** 资源解析（source/src/path → 可加载 URL）；缺省或失败返回 undefined（不静默伪造） */
  resolveResource?: (path: string) => string | undefined;
}

/** 渲染器：把元素渲染进自己的容器（返回根节点以便统一应用样式） */
export type ElementRenderer = (ctx: ElementRenderContext) => HTMLElement;

export interface ElementRegistry {
  /** 注册/覆盖（同类型再注册 = 替换，宿主扩展与开发热替换语义） */
  register(type: string, renderer: ElementRenderer): void;
  /** 解析渲染器；未注册 = undefined（fail-closed，宿主必须显式上报） */
  get(type: string): ElementRenderer | undefined;
  has(type: string): boolean;
  /** 已注册类型（诊断/清单用） */
  types(): string[];
}

export function createElementRegistry(): ElementRegistry {
  const renderers = new Map<string, ElementRenderer>();
  return {
    register(type: string, renderer: ElementRenderer): void {
      renderers.set(type, renderer);
    },
    get(type: string): ElementRenderer | undefined {
      return renderers.get(type);
    },
    has(type: string): boolean {
      return renderers.has(type);
    },
    types(): string[] {
      return [...renderers.keys()];
    },
  };
}
