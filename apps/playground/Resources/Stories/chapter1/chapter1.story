{
  "formatVersion": 1,
  "columns": [
    {
      "id": "start",
      "kind": "flow",
      "commands": [
        {
          "op": "bgm",
          "resource": "Audio/crickets_night01.mp3",
          "volume": 0.4,
          "fade": 1200
        },
        {
          "op": "set",
          "key": "player.gold",
          "value": "+= {20}"
        },
        {
          "op": "character",
          "key": "灵泛",
          "name": "灵泛",
          "color": "#7aa2f7"
        },
        {
          "op": "say",
          "text": "你有 {player.gold:000} 枚金币（插值 + 补零格式化）。",
          "speaker": "灵泛",
          "z": 2000
        },
        {
          "op": "say",
          "text": "富文本：{b}加粗{/b}、{i}斜体{/i}、{u}下划线{/u}、{color=#FFD700}金色{/color}、{color=#9ece6a}{size=22}大字{/size}{/color}。"
        },
        {
          "op": "input",
          "prompt": "旅人，报上名来：",
          "store": "player.name"
        },
        {
          "op": "if",
          "cond": "{player.gold >= 25}",
          "then": [
            {
              "op": "notify",
              "text": "金币充足！当前 {player.gold} 枚。",
              "type": "info"
            },
            {
              "op": "func",
              "name": "greet",
              "params": [
                "who"
              ],
              "body": [
                {
                  "op": "say",
                  "speaker": "{who}",
                  "text": "{who}，欢迎来到灵泛！"
                }
              ]
            },
            {
              "op": "call",
              "target": "greet",
              "args": [
                "{player.name}"
              ]
            }
          ],
          "else": [
            {
              "op": "say",
              "text": "囊中羞涩……先去赚点钱吧。"
            }
          ]
        },
        {
          "op": "wait",
          "seconds": 1.5,
          "skipable": true
        },
        {
          "op": "say",
          "text": "（等待 1.5 秒可点击跳过）"
        },
        {
          "op": "se",
          "resource": "Audio/chest_drawer_open.mp3",
          "volume": 0.7
        },
        {
          "op": "nvl",
          "mode": "enter"
        },
        {
          "op": "say",
          "text": "NVL 累积：第一段。"
        },
        {
          "op": "say",
          "text": "第二段（滚动累积）。"
        },
        {
          "op": "say",
          "text": "第三段。"
        },
        {
          "op": "nvl",
          "mode": "exit"
        },
        {
          "op": "say",
          "text": "NVL 退出，回到普通对话。"
        },
        {
          "op": "cutscene",
          "resource": "Video/m1.mp4",
          "volume": 0.8,
          "skipable": true,
          "z": 1450
        },
        {
          "op": "say",
          "text": "过场结束——播完或点击跳过都会继续。"
        },
        {
          "op": "guard",
          "fn": "gold-non-negative"
        },
        {
          "op": "menu",
          "prompt": "接下来去哪里？",
          "options": [
            {
              "text": "酒馆",
              "target": "inn"
            },
            {
              "text": "广场",
              "target": "square"
            },
            {
              "text": "元素舞台",
              "target": "stage_demo"
            },
            {
              "text": "TS 能力",
              "target": "ts_power"
            },
            {
              "text": "词汇全席",
              "target": "tour"
            }
          ]
        }
      ]
    },
    {
      "id": "inn",
      "kind": "flow",
      "commands": [
        {
          "op": "say",
          "text": "欢迎光临，{player.gold} 金币的贵客！",
          "speaker": "酒馆老板"
        },
        {
          "op": "jump",
          "target": "end"
        }
      ]
    }
  ]
}
