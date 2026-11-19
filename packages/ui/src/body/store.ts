/**
 * 列身体的订阅通路：把「这一屏渲染谁、带什么入参」做成一个**宿主无关**的可订阅值。
 *
 * 与挂载表 store（`mount/store.ts`）是同一件事的两条通道：挂载表是「叠加层清单」
 * （多项、原始值），身体是「这一屏的身体」（单槽、已投影成 `BodyView | null`）。
 * 订阅 / 退订 / 同引用去重的机制只有一份实现（复用挂载域的值格），这里只把值类型
 * 适配到身体的单槽语义——不另起一套监听器管理。
 *
 * 为什么不让各形态自己订阅引擎：订阅与退订就成了多份实现，任何一份漏掉退订都会在
 * 页面拆掉之后继续往已销毁的渲染树里写。值在这里只有一条通路。
 *
 * 本文件不碰 DOM、不认识框架、没有模块级可变状态——一个 store 的全部状态都在闭包里。
 */
import { createMountStore } from "../mount/store.ts";
import type { BodyView } from "./layer.ts";

/** 只读视图：声明式宿主拿它渲染，命令式宿主拿它算差量 */
export interface BodySource {
  /** 当前身体视图；没有身体（或引擎还没报过）时是 `null` */
  snapshot(): BodyView | null;
  /** 订阅变化，返回退订函数。订阅时**不**立刻回调——调用方先自己读一次快照 */
  subscribe(listener: (view: BodyView | null) => void): () => void;
}

/** 可写视图：只有装配处拿得到，写入口不在渲染器手里 */
export interface BodyStore extends BodySource {
  /** 写入新视图；`null` 表示这一屏没有身体 */
  set(view: BodyView | null): void;
}

/**
 * 造一个身体 store。
 *
 * 值格内部用 `undefined` 表示「还没报过」，对外一律投影成 `null`（没有身体）——
 * 消费方不必区分「引擎没写」与「写了个空身体」，两者渲染结果相同。
 *
 * @param initial 初始视图；缺省 `null` 即「这一屏没有身体」
 */
export function createBodyStore(initial: BodyView | null = null): BodyStore {
  const cell = createMountStore(initial ?? undefined);
  const read = (): BodyView | null =>
    (cell.snapshot() as BodyView | undefined) ?? null;
  return {
    snapshot: read,
    set(view: BodyView | null): void {
      cell.set(view ?? undefined);
    },
    subscribe(listener: (view: BodyView | null) => void): () => void {
      return cell.subscribe(() => listener(read()));
    },
  };
}
