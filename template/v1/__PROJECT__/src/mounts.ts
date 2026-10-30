/**
 * UI 注册表的宿主侧出口：`src/**` 内引用生成物的唯一位置。
 *
 * 表由 `stories:build` 从 `src/ui/<名>/` 扫描产出到 `src/gen/`，键就是 `SYS.mounts`
 * 里的名字（= 目录名），因此宿主侧不需要再归一、也不需要手写注册表——手写名单在
 * 「加了 UI 却忘了登记」时只会表现成运行期「这个 UI 不出现」，而磁盘事实不会漏。
 *
 * 三形态（原生 / Vue / React）都从这里取，好让生成物的路径只出现一处：
 * 换生成器输出名时只改本文件。故事源不经过这里——它按 `*.vue` 的具名导入拿句柄。
 */
import { createMountStore } from "@lingfan-engine/ui";

export { uis } from "./gen/ui_register.g";

/**
 * 挂载状态的宿主侧副本（框架无关）。
 *
 * 引擎每写一次 `SYS.mounts`，`bootHost` 就把新值放进来；框架形态的渲染组件订阅它
 * 拿最新值，原生形态不订阅（渲染器自己算差量）。放在这里而不是各形态一份，是因为
 * 「值从哪来」三形态完全一样，只有「怎么落成 DOM」不同。
 */
export const mountStore = createMountStore();
