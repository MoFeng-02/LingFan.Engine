/**
 * 页面注册表（宿主侧）：列 id → 页面工厂。
 *
 * 页面是**整屏界面**（标题菜单、章节界面），与挂在游戏画面之上的常驻叠加层是两回事：
 * 切走即真正销毁，没有隐藏态。引擎不认识页面，只认识列 id 与列类型；「这一列由哪个
 * 页面渲染」是**装配知识**，因此留在宿主，不进框架无关的展示层包——否则那个包会开始
 * 认识 Vue/React，破坏「框架无关」。
 *
 * **未注册列不是错误**：列照常按 op 渲染，只是没有自定义界面——这是降级而非失败，
 * 故 `get` 返回 `undefined` 而不抛（小游戏注册表则相反：它承诺回填结果，未注册必须
 * fail-closed）。反之，**非法列 id 注册**是装配写错，一律拒绝并上报。
 *
 * 用法：组合根建表 → 逐列注册 → 列切换处 `get(列 id)?.(ctx)` 拿到页面再挂载。
 */

import type {
  GameStateWriter,
  PlayerPreferences,
  StateReader,
  StoryEngine,
} from "@lingfan-engine/core";

/**
 * 列 id 形态：小写字母开头，其后是小于字母 / 数字 / `_` / `-`，总长 1..32。
 *
 * 与引擎的短标识（扩展 id、玩法系统 id）是同一套写法。引擎把它定义在自己的内部文件里、
 * 未从包出口转发，宿主也不能为了它去改引擎包，故此处镜像一份；两者是否仍然一致，
 * 由 `tests/template/page-registry.test.ts` 拿引擎出口的形态常量逐条对齐来守住。
 */
const COLUMN_ID_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

/**
 * 页面能看到的全部能力。
 *
 * **读只经 `StateReader`，写只经命令面**：永不直接摸状态源，否则页面会绕过读口的
 * 形状校验（被改坏的存档会让界面去播放不存在的资源）。
 */
export interface PageContext {
  /** 只读状态口（含当前列 id / 列类型） */
  readonly reader: StateReader;
  /**
   * 命令面：**只有这五个**（能力最小化）。
   *
   * 页面若能调 `get`，就会有人拿它绕过 `StateReader`；若能调元素命令执行器，
   * 就会有人把页面当脚本执行器用。类型层面收窄即可，不做运行期包装。
   */
  readonly engine: Pick<
    StoryEngine,
    "navigate" | "choose" | "input" | "save" | "load"
  >;
  /** 玩家偏好（可读写：页面上的音量/字速控件直接落这里） */
  readonly preferences: PlayerPreferences;
  /** 外部系统状态写入口 */
  readonly gameState: GameStateWriter;
}

/**
 * 一个页面实例。
 *
 * `mount` 给容器与上下文，`unmount` 由宿主在离开该列时调用，且必须**真正销毁**
 * （Vue `app.unmount()` / React `root.unmount()` / 原生 DOM 清空并解绑监听）——
 * 不留隐藏节点在后台。挂载目标的容器由宿主常驻，本层不动容器本身。
 */
export interface Page {
  mount(container: HTMLElement, ctx: PageContext): void;
  unmount(): void;
}

/** 页面工厂：每次进入该列都造一个新实例（新实例，不复用旧实例） */
export type PageFactory = (ctx: PageContext) => Page;

/** 列 id → 页面工厂的查表 */
export interface PageRegistry {
  /** 注册/覆盖（同列 id 再注册 = 替换，开发热替换语义；非法 id 被拒绝并上报） */
  register(columnId: string, factory: PageFactory): void;
  /** 解析工厂；未注册 = `undefined`（回落默认渲染，不抛） */
  get(columnId: string): PageFactory | undefined;
}

/** 注册表装配项 */
export interface PageRegistryOptions {
  /**
   * 非法列 id 的诊断出口；缺省写控制台。
   *
   * 留出口是为了让宿主把装配错误显示到自己的错误条上，而不是只躺在控制台里
   * ——页面上看不见的那行错，排查时等于不存在。
   */
  onInvalidId?: (message: string) => void;
}

/** 造一张空的页面表；页面由宿主在装配期逐列注册 */
export function createPageRegistry(
  options: PageRegistryOptions = {},
): PageRegistry {
  const factories = new Map<string, PageFactory>();
  const reportInvalidId =
    options.onInvalidId ??
    ((message: string): void => {
      console.error(`[host] ${message}`);
    });

  return {
    register(columnId: string, factory: PageFactory): void {
      if (typeof columnId !== "string" || !COLUMN_ID_PATTERN.test(columnId)) {
        reportInvalidId(
          `页面注册被拒：列 id 不合法：${String(columnId)}（须匹配 ${COLUMN_ID_PATTERN.source}）`,
        );
        return;
      }
      if (typeof factory !== "function") {
        reportInvalidId(`页面注册被拒：列 ${columnId} 的工厂不是函数`);
        return;
      }
      factories.set(columnId, factory);
    },
    get(columnId: string): PageFactory | undefined {
      return factories.get(columnId);
    },
  };
}
