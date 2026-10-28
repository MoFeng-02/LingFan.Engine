// __PROJECT__ 示例工程（文本形态 = JSON v1 的投影）
// 资源路径相对项目资源根 Resources/：如 bgm "Audio/main.mp3"
// 一个文件里可以写多列（label / scene）；拆文件时把新文件加进 src/main.ts 的 STORIES 列表。

// 标题界面：`type=ui` 的列不进历史、不进存档、不建检查点——它是界面，不是剧情。
// 下面这些命令是**没有页面时的兜底**：宿主若按列 id 注册了整屏页面
// （见 src/host/pages/title-page.ts 与各框架叠加层的 src/pages/），页面会盖在上面；
// 没注册就照常按 op 渲染，开箱即跑。
scene title_main type=ui
  say "欢迎来到 __PROJECT__。"
  say "在 Resources/Stories/ 下继续写你的故事；媒体放 Resources/{Audio,Images,Video}。"
  menu "接下来去哪里？"
    "开始游戏" -> chapter1
    "看舞台元素" -> stage_demo

// 游戏正文第一列：进入这里才开始有历史与存档。
scene chapter1
  input "先问一句：你叫什么名字？" store="player.name"
  say "你好，{player.name}！"
  say "这一列是 game 列：从这里开始，每一步都可回溯、可存档。"
  menu "接下来去哪里？"
    "看舞台元素" -> stage_demo
    "回标题界面" -> title_main

// scene 列 = 声明式空间层：进入本列时整体装载，切换列时清空
scene stage_demo
  panel x=5% y=10% width=90% zindex=10
    text "scene 列 = 声明式空间层：这些方块是元素，不是对话"
    text "panel 是容器，子元素用更深缩进写"
  say "进入 scene 列：元素已整体装载（回顾/读档会自动随行）。"
  say "下一条会隐藏对话框，再下一条让它回来。"
  window hide
  say "（对话框已隐藏——点击继续）"
  window show
  say "对话框回来了。层级、存档槽位等工程配置见 README 的边界表。"
