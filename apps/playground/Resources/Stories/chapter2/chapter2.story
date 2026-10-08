{
  "formatVersion": 1,
  "columns": [
    {
      "id": "square",
      "kind": "flow",
      "commands": [
        {
          "op": "say",
          "text": "热身第 1 组：甩了甩手腕（构建期 do-while 生成）。",
          "speaker": "旁白"
        },
        {
          "op": "say",
          "text": "热身第 2 组：甩了甩手腕（构建期 do-while 生成）。",
          "speaker": "旁白"
        },
        {
          "op": "say",
          "text": "热身第 3 组：甩了甩手腕（构建期 do-while 生成）。",
          "speaker": "旁白"
        },
        {
          "op": "say",
          "text": "广场上只有风声。"
        },
        {
          "op": "minigame",
          "game": "click3",
          "config": {
            "target": 3
          },
          "reward": [
            {
              "key": "player.gold",
              "value": 10
            }
          ]
        },
        {
          "op": "say",
          "text": "你活动了一下手腕（小游戏演示完成，金币 +10）。"
        },
        {
          "op": "jump",
          "target": "end"
        }
      ]
    },
    {
      "id": "stage_demo",
      "kind": "scene",
      "elements": [
        {
          "type": "background",
          "source": "Images/lingfan.png",
          "x": "0",
          "y": "0",
          "width": "100%",
          "height": "100%",
          "opacity": 0.35
        },
        {
          "type": "text",
          "id": "title",
          "text": "元素系统 · 最小闭环",
          "x": "5%",
          "y": "12%",
          "width": "90%",
          "halign": "center",
          "size": 34,
          "color": "#FFD700"
        },
        {
          "type": "panel",
          "id": "box",
          "x": "5%",
          "y": "32%",
          "width": "90%",
          "spacing": 12,
          "zindex": 20,
          "children": [
            {
              "type": "text",
              "text": "容器内子元素（panel → children）",
              "color": "#9ece6a"
            },
            {
              "type": "button",
              "text": "回到故事",
              "id": "btn_back",
              "nav": "start"
            },
            {
              "type": "button",
              "text": "摸一下钱袋（+10 金币）",
              "id": "btn_coin",
              "ops": [
                {
                  "op": "set",
                  "key": "player.gold",
                  "value": "+= {10}"
                },
                {
                  "op": "se",
                  "resource": "Audio/chest_drawer_open.mp3",
                  "volume": 0.6
                },
                {
                  "op": "notify",
                  "text": "钱袋沉了一点（元素 ops：变量 + 音效 + 提示）",
                  "type": "info"
                }
              ]
            },
            {
              "type": "button",
              "text": "金币不足时禁用的按钮（点不动）",
              "id": "btn_locked",
              "disabled": "{player.gold < 100}",
              "disabled_color": "#565f89",
              "disabled_opacity": 0.5,
              "ops": [
                {
                  "op": "notify",
                  "text": "不该看到这句：金币 >= 100 才会启用",
                  "type": "warning"
                }
              ]
            },
            {
              "type": "text",
              "text": "提示 1：元素也是数据——这一行由构建期 for 生成",
              "id": "hint_1",
              "y": "64%",
              "color": "#565f89",
              "size": 14
            },
            {
              "type": "text",
              "text": "提示 2：元素也是数据——这一行由构建期 for 生成",
              "id": "hint_2",
              "y": "72%",
              "color": "#565f89",
              "size": 14
            },
            {
              "type": "text",
              "text": "提示 3：元素也是数据——这一行由构建期 for 生成",
              "id": "hint_3",
              "y": "80%",
              "color": "#565f89",
              "size": 14
            }
          ]
        }
      ],
      "entry": [
        {
          "op": "say",
          "text": "这里是元素舞台——背景、标题、容器与按钮都是声明式元素。",
          "speaker": "灵泛"
        },
        {
          "op": "say",
          "text": "点击后依次执行：追加元素 → 淡入动画 → 样式与层级调整 → 屏幕震动 → 全屏转场。"
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
          "target": "title",
          "props": {
            "color": "#9ece6a"
          }
        },
        {
          "op": "zindex",
          "target": "title",
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
          "text": "完成：标题已改绿、层级已提升，追加的图已淡入。"
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
          "text": "背景已切换（bg_switch）。接下来演示「外部玩法系统接管」。"
        },
        {
          "op": "say",
          "text": "即将把控制权交给行走系统：用 A/D 或 ←/→ 把人走到终点（回溯/离开可中断）。"
        },
        {
          "op": "interaction",
          "system": "walk",
          "config": {
            "target": 160
          }
        },
        {
          "op": "say",
          "text": "接管已结束，故事继续——外部系统写入的坐标可在故事里读：{game.walk.x}。"
        }
      ]
    }
  ]
}
