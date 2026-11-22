// 文本创作流 · 画廊列：同一张立绘五种 elementFit（stretch）对比。
// 由 feat_play 的 walk 交互成功分流进入（interaction onSuccess="text_gallery"）。
// scene 列元素行归 elements（宿主元素层渲染，独立于 body），entry 命令归说白与菜单。
// background 与 op 同名，元素行必须 element 前缀；image/text 裸写即可。
scene "text_gallery"
  element background "Images/hall.svg"
  text "elementFit 对比：同图不同 stretch" x=40 y=24
  image "Images/lingfan.png" x=40 y=80 width=200 height=200 stretch=fill
  text "fill（拉伸填满）" x=40 y=290
  image "Images/lingfan.png" x=280 y=80 width=200 height=200 stretch=contain
  text "contain（完整留白）" x=280 y=290
  image "Images/lingfan.png" x=520 y=80 width=200 height=200 stretch=cover
  text "cover（裁切铺满）" x=520 y=290
  image "Images/lingfan.png" x=760 y=80 width=200 height=200 stretch=none
  text "none（原始尺寸）" x=760 y=290
  image "Images/lingfan.png" x=1000 y=80 width=200 height=200 stretch=scale-down
  text "scale-down（取小）" x=1000 y=290
  say "同一张立绘，五种 stretch：fill 拉伸填满、contain 完整留白、cover 裁切铺满、none 原始尺寸、scale-down 取 none 与 contain 较小者。" speaker="灵泛"
  say "元素行直接写 stretch=…，投影进 JSON 元素的 props；宿主元素层按 object-fit 渲染。" speaker="灵泛"
  menu "画廊看完了，去哪里？"
    "继续小游戏故事（回 feat_play）" -> feat_play
    "回功能演示枢纽" -> feat_hub