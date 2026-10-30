/**
 * 屏幕态的宿主侧副本（框架无关）。
 *
 * 引擎只知道自己停在哪一列、那一列是什么类型；「此刻该画启动界面还是游戏」是宿主
 * 的判断，折膜在 `@lingfan-engine/ui` 的 `screenViewOf`，这里是它的存放处。
 *
 * 与 `mounts.ts` 同一个理由放在骨架而不是各形态一份：「值从哪来」三形态完全一样
 * （`bootHost` 的 `onScreen` 往里写），只有「怎么落成 DOM」不同——原生形态由
 * `host/switch.ts` 自己造节点，框架形态订阅本盒。
 *
 * 原生形态不订阅它：`switch.ts` 收到值就直接落 DOM，中间再存一份只会多一个可能
 * 不同步的副本。
 */
import { createScreenStore } from "@lingfan-engine/ui";

/** 屏幕态订阅盒：`bootHost` 的 `onScreen` 往里写，框架形态的界面组件订阅它 */
export const screenStore = createScreenStore();
