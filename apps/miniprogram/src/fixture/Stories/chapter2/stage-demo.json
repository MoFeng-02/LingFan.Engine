{
  "formatVersion": 1,
  "id": "stage_demo",
  "kind": "flow",
  "commands": [
    {
      "op": "say",
      "text": "这里是元素舞台——人物、特效与转场全部由命令 op 承载。",
      "speaker": "灵泛"
    },
    {
      "op": "say",
      "text": "依次执行：追加元素 → 淡入动画 → 样式与层级调整 → 屏幕震动 → 全屏转场。"
    },
    {
      "op": "show",
      "target": "Images/lingfan.png",
      "id": "hero",
      "name": "cast",
      "x": 40,
      "y": 120,
      "background": false
    },
    {
      "op": "animate",
      "target": "hero",
      "property": "opacity",
      "value": 0.9,
      "duration": 1,
      "easing": "EaseOutQuad"
    },
    {
      "op": "style",
      "target": "hero",
      "props": {
        "color": "#9ece6a"
      }
    },
    {
      "op": "zindex",
      "target": "hero",
      "value": 30
    },
    {
      "op": "shake",
      "intensity": 6,
      "duration": 0.4
    },
    {
      "op": "transition",
      "type": "fade",
      "duration": 0.6
    },
    {
      "op": "say",
      "text": "完成：样式已改绿、层级已提升，追加的图已淡入。"
    },
    {
      "op": "hide",
      "target": "cast"
    },
    {
      "op": "say",
      "text": "按 name 批量隐藏（cast 组）已完成，可看到图消失。"
    },
    {
      "op": "bg_switch",
      "resource": "Images/lingfan.png"
    },
    {
      "op": "say",
      "text": "背景已切换（bg_switch）。回「开始故事」列可继续。"
    }
  ]
}
