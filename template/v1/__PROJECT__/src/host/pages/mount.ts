/**
 * 页面挂载器：列切换时把「这一列由哪个页面渲染」落到 DOM 上。
 *
 * **页面切换 = 完整界面替换**：离开页面必须真正销毁，不允许把旧界面「藏起来」留在后台。
 * 理由有两条，缺一条这个设计就不成立：
 * 1. **内存**——菜单页的组件树、监听器、定时器在游戏开始后不再有任何意义，留着是纯浪费，
 *    对内存吃紧的设备尤其如此；
 * 2. **分类清晰**——「此刻在哪个界面」必须只有一个答案；后台若还挂着上一个页面，
 *    状态查询、焦点、无障碍树都会出现两个答案。
 *
 * 容器**常驻**：`#page` 这个节点从装配到拆除一直存在，切换只动它的子节点。
 * 反复建删容器节点会让布局与滚动位置跳动，而且调用方得记住「容器是谁建的」。
 *
 * **本模块不做的事**：不认识 Vue / React / 原生 DOM——框架的卸载钩子（`app.unmount()` /
 * `root.unmount()` / 解绑监听）由页面实现自己在 `unmount()` 里调。这里只保证两件事：
 * 按序调用 `unmount()`，以及**兜底清空容器**——页面实现漏了清理时，界面仍然真的没了。
 *
 * 同一个列内推进（坐标变、列 id 不变）不触发任何挂载/卸载：那是剧情在走，不是换界面。
 */

import {
  SYS,
  type GameStateWriter,
  type PlayerPreferences,
  type StateReader,
  type StoryEngine,
} from "@lingfan-engine/core";
import type { Page, PageContext, PageRegistry } from "./registry.js";

/**
 * 页面容器与根节点的活区标记名。
 *
 * 页面上没这个标记时，滚轮会连带触发故事回溯（回溯滚轮见渲染交互契约）——整屏界面把指针事件
 * 接管之后，回溯滚轮是最容易被误触发的那一类。
 */
const PAGE_ZONE_ATTRIBUTE = "data-ui-zone";
const PAGE_ZONE_NAME = "page";

/** 挂载器的输入 */
export interface PageMountOptions {
  /** 列 id → 页面工厂的查表（未注册列 = 回落 op 渲染） */
  registry: PageRegistry;
  /** 常驻页面容器（宿主在 `index.html` 里给出，装配期不新建） */
  container: HTMLElement;
  /** 引擎：列 id 的状态订阅来源 */
  engine: StoryEngine;
  /** 只读状态口（交给页面的那份） */
  reader: StateReader;
  /** 玩家偏好（交给页面的那份） */
  preferences: PlayerPreferences;
  /** 外部玩法状态写入面（交给页面的那份） */
  gameState: GameStateWriter;
  /** 诊断出口（页面 mount 抛错时上报，不让一个坏页面吃掉整个宿主） */
  reportError(message: string): void;
}

/** 页面挂载器 */
export interface PageMounter {
  /**
   * 按当前列对齐一次（装配期调一次即可；之后由状态订阅驱动）。
   *
   * 幂等：列 id 未变时什么都不做——这也是同列推进、热重载重进同列不会重挂的原因。
   */
  sync(): void;
  /** 拆除：卸载当前页面并清空容器，之后不再响应状态（重复调用只生效第一次） */
  dispose(): void;
}

/** 当前挂着的页面（`null` = 当前列没有页面，正在按 op 渲染） */
interface MountedPage {
  readonly columnId: string;
  readonly page: Page;
}

/**
 * 造一个页面挂载器：订阅 `SYS.currentSceneColumn`，列 id 变化时卸载旧页面、挂载新页面。
 *
 * @param options 见 {@link PageMountOptions}
 */
export function createPageMounter(options: PageMountOptions): PageMounter {
  const {
    registry,
    container,
    engine,
    reader,
    preferences,
    gameState,
    reportError,
  } = options;

  // 容器常驻：活区标记在装配期打一次即可（`replaceChildren` 不动容器自身属性）
  container.setAttribute(PAGE_ZONE_ATTRIBUTE, PAGE_ZONE_NAME);

  let current: MountedPage | null = null;
  let disposed = false;

  /** 交给页面的那份上下文（每次挂载新造：页面之间不该共享可变引用） */
  function context(): PageContext {
    return { reader, engine, preferences, gameState };
  }

  /** 清空容器（真销毁的最终保证：页面实现漏了清理时，界面也真的没了） */
  function clearContainer(): void {
    if (container.childElementCount > 0) container.replaceChildren();
  }

  /** 卸载当前页面：先让它自己收尾，再兜底清场 */
  function unmountCurrent(): void {
    const mounted = current;
    current = null;
    if (mounted === null) return;
    try {
      mounted.page.unmount();
    } catch (error) {
      // 页面的清理代码抛错不能连累宿主：容器照样清，下一个页面照样能挂
      reportError(`页面卸载失败：列 ${mounted.columnId}：${String(error)}`);
    }
    clearContainer();
  }

  /** 把容器对齐到某一列：没有页面工厂 = 回落 op 渲染（清空即可，降级不是错误） */
  function mountFor(columnId: string): void {
    const factory = columnId === "" ? undefined : registry.get(columnId);
    if (factory === undefined) {
      // 空列 id（尚未进列 / 值被改坏）与未注册列同一处理：没有自定义界面
      clearContainer();
      return;
    }
    let page: Page;
    try {
      page = factory(context());
    } catch (error) {
      reportError(`页面构造失败：列 ${columnId}：${String(error)}`);
      clearContainer();
      return;
    }
    try {
      page.mount(container, context());
    } catch (error) {
      // 挂载失败：别再把它当成"当前页面"，否则下次切换会去卸载一个半死的实例
      reportError(`页面挂载失败：列 ${columnId}：${String(error)}`);
      try {
        page.unmount();
      } catch {
        // 半挂载状态的卸载失败无信息量，已经报过挂载错误了
      }
      clearContainer();
      return;
    }
    current = { columnId, page };
  }

  /** 与当前列对齐一次 */
  function sync(): void {
    if (disposed) return;
    const columnId = reader.currentColumnId();
    // 同列：什么都不做（同列推进、热重载重进同列都不该重挂）
    if (current !== null && current.columnId === columnId) return;
    if (current === null && columnId === "") return;
    unmountCurrent();
    mountFor(columnId);
  }

  const offStateChanged = engine.onStateChanged(({ key }) => {
    if (key !== SYS.currentSceneColumn) return;
    sync();
  });

  // 装配期先对齐一次：引擎可能已经进了列（宿主在 start 之前就订阅，但热重载路径会重进）
  sync();

  return {
    sync,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      offStateChanged();
      unmountCurrent();
    },
  };
}
