/**
 * 星穹列：整屏画面是一个编译进来的实时渲染组件（PixiJS 粒子星空）。
 * body 句柄由场景注册表生成，列本身不带图元——画面完全交给组件。
 */
import { starfield as starfieldScene } from "../../gen/scene_register.g";

export const columnKind = "scene";
export const body = starfieldScene;

export default function starfield(): void {}
