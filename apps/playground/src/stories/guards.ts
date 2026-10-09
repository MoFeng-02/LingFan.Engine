/**
 * 故事守卫的生成物入口：`src/**` 内引用生成注册表的唯一位置。
 *
 * 生成物由 `stories:build` 从 `Stories.src/story.ts` 的 cell 槽位产出，组合根零手写注册；
 * 名字闭合（故事引用 ⊆ 生成注册表）由构建期闸门执法。其它模块需要守卫时一律从这里取，
 * 好让生成物的路径只出现一处——换生成器输出名时只改本文件。
 */
export { guards } from "../../Stories.src/gen/fun_register.g";
