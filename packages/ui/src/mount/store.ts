/**
 * 挂载表订阅：把 `SYS.mounts` 的变化做成一个**宿主无关**的可订阅值。
 *
 * 三种宿主形态要的是同一件事——「现在该挂谁、各自带什么入参」，但拿值的方式不同：
 * 命令式宿主（原生 DOM）要一个回调去算差量，声明式宿主（Vue / React）要一个能进各自
 * 响应式系统的快照 + 订阅对。这里只提供最小面：`snapshot()` 读当前值、`subscribe()`
 * 订阅变化、`set()` 由装配处把引擎状态推进来。
 *
 * 为什么不让各形态自己订阅引擎：订阅与退订就成了三份实现，任何一份漏掉退订都会在
 * 页面拆掉之后继续往已销毁的渲染树里写。值在这里只有一条通路。
 *
 * 本文件不碰 DOM、不认识框架、没有模块级可变状态——一个 store 的全部状态都在闭包里。
 */

/** 只读视图：声明式宿主拿它渲染，命令式宿主拿它算差量 */
export interface MountSource {
  /** 当前 `SYS.mounts` 原始值；引擎还没写过时是 `undefined` */
  snapshot(): unknown;
  /** 订阅变化，返回退订函数。订阅时**不**立刻回调——调用方先自己读一次快照 */
  subscribe(listener: (raw: unknown) => void): () => void;
}

/** 可写视图：只有装配处拿得到，写入口不在渲染器手里 */
export interface MountStore extends MountSource {
  /** 写入新值；与当前值是同一个引用时不通知（引擎写侧本就是整表新建） */
  set(raw: unknown): void;
}

/**
 * 造一个挂载表 store。
 *
 * @param initial 初始值；缺省 `undefined` 即「引擎还没报过」，投影按空表处理
 */
export function createMountStore(initial?: unknown): MountStore {
  let current: unknown = initial;
  const listeners = new Set<(raw: unknown) => void>();
  return {
    snapshot(): unknown {
      return current;
    },
    set(raw: unknown): void {
      if (Object.is(raw, current)) return;
      current = raw;
      // 复制一份再遍历：监听器里退订自己是常见写法，直接遍历 Set 会跳过后一个
      for (const listener of [...listeners]) listener(current);
    },
    subscribe(listener: (raw: unknown) => void): () => void {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
  };
}
