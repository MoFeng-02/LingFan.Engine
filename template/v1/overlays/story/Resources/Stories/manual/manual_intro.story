// __PROJECT__ 的手写故事示例（文本形态 = JSON v1 的投影）
// 资源路径相对项目资源根 Resources/：如 bgm "Audio/main.mp3"
// 一个文件里可以写多列（label / scene）；拆文件直接放进 Resources/Stories/ 下，构建期扫描自动收录。
//
// 这份示例与骨架自带的 `Stories/title/*.json` 并存：TS 源、手写 .story、手写 .json
// 是同一棵树上的三种文件形态，可以混装。列 id 全在 `manual_` 命名空间里，
// 因此不会与骨架已有的 `title_main` / `look_around` 撞名（列 id 全工程唯一）。
// 想从这里接着写，改本文件即可；要切回 TS 源，往 src/Stories.src 里加列即可，两边互不影响。

// 标题界面：`type=ui` 的列不进历史、不进存档、不建检查点——它是界面，不是剧情。
// 引擎对这类列只管一件事：按 op 渲染（say 出一句、menu 出一组选项），所以下面几条开箱即跑，
// 视图上就是标题界面本身。想换成自己的视觉有两条路：常驻舞台的组件放 src/ui/ 并用 mount 控显隐；
// 整屏的标题页/设置页属宿主应用，落 src/pages/ 一类宿主目录、由宿主自己切进切出。
scene manual_intro type=ui
  say "这一段来自 Resources/Stories/manual/manual_intro.story。"
  say "文本故事、手写 JSON、TS 源可以同时在 Resources/Stories/ 下混装；列 id 全工程唯一即可。"
  menu "接下来去哪里？"
    "看对话与输入" -> manual_talk
    "看舞台元素" -> manual_stage

// 游戏正文第一列：进入这里才开始有历史与存档。
scene manual_talk
  input "先问一句：你叫什么名字？" store="player.name"
  say "你好，{player.name}！"
  say "这一列是 game 列：从这里开始，每一步都可回溯、可存档。"
  menu "接下来去哪里？"
    "看舞台元素" -> manual_stage
    "回这一列开头" -> manual_talk

// scene 列 = 声明式空间层：进入本列时整体装载，切换列时清空
scene manual_stage
  panel x=5% y=10% width=90% zindex=10
    text "scene 列 = 声明式空间层：这些方块是元素，不是对话"
    text "panel 是容器，子元素用更深缩进写"
  say "进入 scene 列：元素已整体装载（回顾/读档会自动随行）。"
  say "下一条会隐藏对话框，再下一条让它回来。"
  window hide
  say "（对话框已隐藏——点击继续）"
  window show
  say "对话框回来了。层级、存档槽位等工程配置见 README 的边界表。"
