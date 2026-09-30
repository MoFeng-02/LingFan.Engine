// __PROJECT__ 示例工程（文本形态 = JSON v1 的投影）
// 资源路径相对项目资源根 Resources/：如 bgm "Audio/main.mp3"
// 一个文件里可以写多列（label / scene）；拆文件时把新文件加进 src/main.ts 的 STORIES 列表。

label title_main:
  say "欢迎来到 __PROJECT__。"
  say "在 Resources/Stories/ 下继续写你的故事；媒体放 Resources/{Audio,Images,Video}。"
  input "先问一句：你叫什么名字？" store="player.name"
  say "你好，{player.name}！"
  menu "接下来去哪里？"
    "看舞台元素" -> stage_demo
    "看重来一次" -> title_main

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