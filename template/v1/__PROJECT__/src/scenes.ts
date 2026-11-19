/**
 * 场景注册表的宿主侧出口：`src/**` 内引用生成物的唯一位置。
 *
 * 表由 `stories:build` 从 `src/scenes/<名>/` 扫描产出到 `src/gen/`，键就是 `SYS.body`
 * 里的名字（= 目录名），因此宿主侧不需要再归一、也不需要手写注册表——手写名单在
 * 「加了身体却忘了登记」时只会表现成运行期「这一屏不出现」，而磁盘事实不会漏。
 *
 * 三形态（原生 / Vue / React）都从这里取，好让生成物的路径只出现一处：
 * 换生成器输出名时只改本文件。故事源不经过这里——它按具名句柄（`export const body =
 * helloScene`）指认身体。与 UI 注册表（`mounts.ts`）物理隔离：两张表各管各的名字空间。
 */
import { createBodyStore } from "@lingfan-engine/ui";

export { scenes } from "./gen/scene_register.g";

/**
 * 身体状态的宿主侧副本（框架无关）。
 *
 * 引擎每写一次 `SYS.body`，`bootHost` 就把投影出的视图放进来；框架形态的渲染组件
 * 订阅它拿最新值，原生形态不订阅（渲染器自己算差量）。放在这里而不是各形态一份，
 * 是因为「值从哪来」三形态完全一样，只有「怎么落成 DOM」不同。
 */
export const bodyStore = createBodyStore();
