/**
 * 本工程的故事文件表（相对资源根 `Resources/`）——**全工程唯一声明点**。
 *
 * 本工程走 TS 创作链：这里列的是 `Stories.src/` 编译出来的产物，
 * 不要直接改 `Resources/Stories/**` 下的文件——它们是生成物，下次构建会被覆盖，
 * 源里没有的旧列还会被清理掉。改故事请改 `Stories.src/`，然后 `pnpm stories:build`。
 *
 * 新增一列后记得回来把产物路径加进本表（Web 形态按显式清单取文件，不扫目录）。
 */
export const STORIES: readonly string[] = ["Stories/title/title_main.json"];
