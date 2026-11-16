/**
 * 大厅：世界地图点开中央石台后进这一屏。身体是 `src/scenes/hall/hall.vue`，
 * 进哪一扇门交给门上的热区，列只负责说明这一屏由谁画。
 *
 * 句柄的导入名与列名相同会与下面的故事函数撞名，故导入时改名；
 * 列 id 由 `export default function` 的函数名决定，不受导入名影响。
 */
import { hall as hallScene } from "../../gen/scene_register.g";

export const columnKind = "scene";
export const body = hallScene;

export default function hall(): void {}
