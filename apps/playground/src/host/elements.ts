/**
 * 舞台元素层：把元素表渲染进容器，并把点击翻译成引擎调用或宿主命令。
 *
 * 元素是**声明式空间层**——引擎只写元素表，谁长什么样、点了做什么由这里决定。
 * 三条纪律：
 * - 未注册的类型 / 命令一律 fail-closed：渲染层不伪造，命令面不静默吞，都上报宿主；
 * - `disabled` 表达式由引擎插值后判定，求值失败按「不禁用」处理（锁死比报错更难恢复）；
 * - 元素表每次渲染都现读，节点每次现查（`findNode`），不做缓存——元素表随时可被整体重建，
 *   缓存会读到已从 DOM 上摘掉的旧节点。
 */
import { type ElementInstance } from "@lingfan/engine";
import {
  type CommandRegistry,
  type ElementResourceResolver,
  createElementRegistry,
  createElementResourceResolver,
  registerBuiltinElementRenderers,
  renderElementTree,
  resolveElementAction,
} from "@lingfan/ui";

/** 元素层需要的引擎命令面 */
export interface ElementEnginePort {
  /** 导航到某列（元素 `nav` 动作） */
  navigate(target: string): void;
  /** 执行元素 `ops` 动作序列；返回是否全部执行成功 */
  runElementOps(ops: readonly Record<string, unknown>[]): boolean;
  /** 表达式插值（`disabled` 求值、`cmd` 取值） */
  interpolate(source: string): string;
}

/** 元素层的输入 */
export interface ElementLayerOptions {
  /** 舞台元素容器；null = 尚未挂载 */
  readContainer(): HTMLElement | null;
  /** 资源解析（元素资源由组合根注入的端口供数） */
  resolveResource(path: string): Promise<string>;
  /** 当前元素表 */
  readElements(): readonly ElementInstance[];
  /** 引擎命令面 */
  engine: ElementEnginePort;
  /** 业务命令注册表（元素 `cmd` 的业务命令由宿主注册） */
  commands: CommandRegistry;
  /** 错误上报（落到错误横幅） */
  reportError(message: string): void;
}

/** 元素层出口 */
export interface ElementLayer {
  /** 整棵重建舞台元素（元素表变化后调用） */
  render(): void;
  /** 按元素 id 找舞台节点；未挂载或找不到时返回 null */
  findNode(id: number): HTMLElement | null;
}

/**
 * 创建元素层。业务命令注册表由调用方持有并注册，这里只负责查表。
 */
export function createElementLayer(options: ElementLayerOptions): ElementLayer {
  const { engine, commands, reportError } = options;
  const registry = createElementRegistry();
  registerBuiltinElementRenderers(registry);

  const resources: ElementResourceResolver = createElementResourceResolver({
    resolve: (path) => options.resolveResource(path),
    onResolved: () => {
      render();
    },
  });

  /**
   * 表达式求值：只有字面 `true` / `false` 算数，其余（含插值失败）返回 null。
   * null = 求值失败，调用方按「不禁用」处理。
   */
  function evalDisable(expression: string): boolean | null {
    const text = engine.interpolate(expression);
    if (text === "true") return true;
    if (text === "false") return false;
    return null;
  }

  /** 元素动作的落点：导航 / op 序列 / 业务命令，三选一；其余不产生动作 */
  function activate(element: ElementInstance): void {
    const action = resolveElementAction(element.props, {
      evalDisable,
    });
    if (action.kind === "nav") {
      engine.navigate(action.target);
      return;
    }
    if (action.kind === "ops") {
      if (!engine.runElementOps(action.ops)) {
        reportError(
          "元素动作执行失败（详见错误横幅：等待/位置类 op 与畸形负载会被拒绝）",
        );
      }
      return;
    }
    if (action.kind !== "cmd") return;
    const handler = commands.get(action.name);
    if (handler === undefined) {
      reportError(
        `元素命令未注册：${action.name}（fail-closed：宿主需经命令注册表提供）`,
      );
      return;
    }
    handler(
      action.value === undefined ? undefined : engine.interpolate(action.value),
      element,
    );
  }

  function render(): void {
    const container = options.readContainer();
    if (container === null) return;
    renderElementTree({
      registry,
      container,
      elements: options.readElements(),
      activate,
      evalDisable,
      resolveResource: resources.resolveForElement,
      onUnknownType: (type) => {
        reportError(`元素类型未注册：${type}（fail-closed：不伪造渲染）`);
      },
    });
  }

  return {
    render,
    findNode(id: number): HTMLElement | null {
      const container = options.readContainer();
      if (container === null) return null;
      return container.querySelector<HTMLElement>(`[data-lf-id="${id}"]`);
    },
  };
}
