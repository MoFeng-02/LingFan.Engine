// 文本创作流 · 故事列：灵泛讲一段旅人传闻（say / menu / set / if + 插值）。
// 由 feat_play 的 click3 小游戏成功分流进入（minigame onSuccess="text_tale"）。
// 文本 DSL 投影成 JSON v1 列，与 TS 编译列同树共存；列 id = 文件名 = 工具生成的 text_tale。
// 立绘装载：hide 幂等清旧 + show 追加（show 不按 id 覆盖）；换表情用 style 改 source。
label "text_tale"
  hide "lingfan"
  show "Images/角色/灵泛_正面.png" id="lingfan" x=860 y=110
  style "lingfan" props={width: 360, height: 560, stretch: "contain"}
  say "小游戏通关，灵泛翻开一页旧传闻。" speaker="灵泛"
  set "player.gold" += {5}
  say "传闻说：北岭的灯夜里会自己亮。你得了 {player.gold} 枚金币作盘缠。" speaker="灵泛"
  if {player.gold >= 120}
    style "lingfan" props={source: "Images/角色/灵泛_娇羞.png"}
    say "盘缠丰厚——灵泛说你可以雇一辆马车北上了。" speaker="灵泛"
  else
    style "lingfan" props={source: "Images/角色/灵泛_手托下巴_疑问.png"}
    say "盘缠尚薄——灵泛劝你再攒些金币，或去广场碰碰运气。" speaker="灵泛"
  style "lingfan" props={source: "Images/角色/灵泛_正面.png"}
  say "这段故事全用文本 DSL 写成，投影成 JSON 列，与 TS 列同树共存。" speaker="灵泛"
  menu "故事讲完了，去哪里？"
    "回功能演示枢纽" -> feat_hub
    "回主线菜单" -> start