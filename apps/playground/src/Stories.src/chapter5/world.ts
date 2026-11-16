/**
 * 世界地图这一屏：身体来自场景注册表（`src/scenes/worldmap/worldmap.vue`），
 * 列本身不带元素——这一屏画什么、点哪里，全由组件自己决定。
 *
 * 组件从 `gen/scene_register.g.ts` 具名导入，构建期据此把句柄绑到场景表；
 * 组件路径与列名不必相同，但目录名、文件名与注册名三者一致才好找。
 */
import { worldmap } from "../../gen/scene_register.g";

export const columnKind = "scene";
export const body = worldmap;

export default function world(): void {}
