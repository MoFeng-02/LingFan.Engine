{
  "formatVersion": 1,
  "columns": [
    {
      "id": "tour",
      "kind": "flow",
      "commands": [
        {
          "op": "say",
          "text": "词汇全席开席——每个站点把一个词汇域做成一道菜，随便点、随便续。",
          "speaker": "灵泛"
        },
        {
          "op": "say",
          "text": "（本列由 TS 源第四章生成：站点清单是构建期常量，菜单选项由 map 生成。）"
        },
        {
          "op": "menu",
          "prompt": "下一道？",
          "options": [
            {
              "text": "变量盛宴",
              "target": "tour_vars"
            },
            {
              "text": "流程厨房",
              "target": "tour_flow"
            },
            {
              "text": "存档试吃",
              "target": "tour_save"
            },
            {
              "text": "声光餐车",
              "target": "tour_av"
            },
            {
              "text": "舞台窗口",
              "target": "tour_stage"
            },
            {
              "text": "扩展工坊",
              "target": "tour_ext"
            },
            {
              "text": "守卫工坊",
              "target": "tour_guard"
            },
            {
              "text": "回主线菜单",
              "target": "start"
            },
            {
              "text": "离席（终幕）",
              "target": "end"
            }
          ]
        }
      ]
    },
    {
      "id": "tour_vars",
      "kind": "flow",
      "commands": [
        {
          "op": "say",
          "text": "变量盛宴——数组、字典、临时变量都是 SSOT 状态，随快照/存档/回溯随行。",
          "speaker": "灵泛"
        },
        {
          "op": "array",
          "key": "bag",
          "items": [
            "火把"
          ]
        },
        {
          "op": "array_push",
          "key": "bag",
          "value": "面包"
        },
        {
          "op": "array_push",
          "key": "bag",
          "value": "旧地图"
        },
        {
          "op": "array_push",
          "key": "bag",
          "value": "提灯"
        },
        {
          "op": "say",
          "text": "行囊就绪：array 建列 + 构建期 map 生成三次 array_push（火把、面包、旧地图、提灯）。"
        },
        {
          "op": "array_pop",
          "key": "bag"
        },
        {
          "op": "say",
          "text": "array_pop 取走最后一件（提灯）——现在剩三件。"
        },
        {
          "op": "dict",
          "key": "gear",
          "value": {
            "weapon": "木剑",
            "armor": "布衣"
          }
        },
        {
          "op": "dict_set",
          "key": "gear",
          "field": "weapon",
          "value": "铁剑"
        },
        {
          "op": "say",
          "text": "装备字典：dict 建档 + dict_set 把武器从木剑升级成铁剑（历史面板可查每次变更）。"
        },
        {
          "op": "let",
          "key": "ticket",
          "value": 1
        },
        {
          "op": "say",
          "text": "let 临时变量：ticket = {ticket}。"
        },
        {
          "op": "undef",
          "key": "ticket"
        },
        {
          "op": "say",
          "text": "undef 已把 ticket 从变量表回收（这句故意不再插值它）。"
        },
        {
          "op": "menu",
          "prompt": "下一道？",
          "options": [
            {
              "text": "变量盛宴",
              "target": "tour_vars"
            },
            {
              "text": "流程厨房",
              "target": "tour_flow"
            },
            {
              "text": "存档试吃",
              "target": "tour_save"
            },
            {
              "text": "声光餐车",
              "target": "tour_av"
            },
            {
              "text": "舞台窗口",
              "target": "tour_stage"
            },
            {
              "text": "扩展工坊",
              "target": "tour_ext"
            },
            {
              "text": "守卫工坊",
              "target": "tour_guard"
            },
            {
              "text": "回主线菜单",
              "target": "start"
            },
            {
              "text": "离席（终幕）",
              "target": "end"
            }
          ]
        }
      ]
    },
    {
      "id": "tour_flow",
      "kind": "flow",
      "commands": [
        {
          "op": "say",
          "text": "流程厨房——随机、多路分支、循环与循环控制全是运行期 op（显式种子 ⇒ 回溯确定性）。",
          "speaker": "灵泛"
        },
        {
          "op": "random",
          "seed": 2026,
          "range": [
            1,
            6
          ],
          "var": "dice"
        },
        {
          "op": "say",
          "text": "掷骰（种子 2026，回溯重放同点数）：{dice} 点。"
        },
        {
          "op": "switch",
          "on": "{dice}",
          "cases": [
            {
              "value": 1,
              "body": [
                {
                  "op": "say",
                  "text": "一点——运气垫底，正适合从头再来。"
                }
              ]
            },
            {
              "value": 6,
              "body": [
                {
                  "op": "say",
                  "text": "六点——大吉！今晚酒钱我出。"
                }
              ]
            }
          ],
          "default": [
            {
              "op": "say",
              "text": "{dice} 点，中规中矩。"
            }
          ]
        },
        {
          "op": "set",
          "key": "n",
          "value": 0
        },
        {
          "op": "while",
          "cond": "{n < 3}",
          "body": [
            {
              "op": "set",
              "key": "n",
              "value": "+= {1}"
            },
            {
              "op": "if",
              "cond": "{n == 2}",
              "then": [
                {
                  "op": "continue"
                }
              ],
              "else": [
                {
                  "op": "say",
                  "text": "报数 {n}（while + continue：2 被跳过）"
                }
              ]
            }
          ]
        },
        {
          "op": "set",
          "key": "m",
          "value": 0
        },
        {
          "op": "while",
          "cond": "{m < 99}",
          "body": [
            {
              "op": "set",
              "key": "m",
              "value": "+= {1}"
            },
            {
              "op": "if",
              "cond": "{m >= 3}",
              "then": [
                {
                  "op": "break"
                }
              ],
              "else": [
                {
                  "op": "say",
                  "text": "冲刺 {m}（break 在 3 收步）"
                }
              ]
            }
          ]
        },
        {
          "op": "array",
          "key": "supplies",
          "items": [
            "火把",
            "面包",
            "旧地图"
          ]
        },
        {
          "op": "for",
          "var": "item",
          "in": "{supplies}",
          "body": [
            {
              "op": "say",
              "text": "for 迭代：{item}"
            }
          ]
        },
        {
          "op": "foreach",
          "var": "thing",
          "key": "supplies",
          "body": [
            {
              "op": "say",
              "text": "foreach 迭代：{thing}"
            }
          ]
        },
        {
          "op": "say",
          "text": "两站同料双炊：for 吃表达式、foreach 按名取集合——产物都是静态 op 序列。"
        },
        {
          "op": "say",
          "text": "本站用 navigate 回菜单（导航清屏，区别于 jump 的原地跳）。"
        },
        {
          "op": "navigate",
          "path": "tour"
        }
      ]
    },
    {
      "id": "tour_save",
      "kind": "flow",
      "commands": [
        {
          "op": "say",
          "text": "存档试吃——存档编排归引擎命令面、安全归 Rust；故事只按名声明。",
          "speaker": "灵泛"
        },
        {
          "op": "auto_save",
          "enabled": true
        },
        {
          "op": "say",
          "text": "auto_save 已开启：从现在起每个等待画面都会自动落检查点档。"
        },
        {
          "op": "save",
          "slot": "tour_slot",
          "title": "词汇全席·存档试吃"
        },
        {
          "op": "say",
          "text": "本句上屏时「存档试吃」档已写入 tour_slot（save op 在等待画面落档）——右上角「读」可随时回来。"
        },
        {
          "op": "save",
          "slot": "temp_demo"
        },
        {
          "op": "say",
          "text": "临时档 temp_demo 也写了一份（纯演示用）。"
        },
        {
          "op": "save_delete",
          "slot": "temp_demo"
        },
        {
          "op": "say",
          "text": "save_delete 已删掉临时档——tour_slot 不受影响。"
        },
        {
          "op": "notify",
          "text": "存档域演示完毕：试试右上角「存 / 读」。",
          "type": "success"
        },
        {
          "op": "menu",
          "prompt": "下一道？",
          "options": [
            {
              "text": "变量盛宴",
              "target": "tour_vars"
            },
            {
              "text": "流程厨房",
              "target": "tour_flow"
            },
            {
              "text": "存档试吃",
              "target": "tour_save"
            },
            {
              "text": "声光餐车",
              "target": "tour_av"
            },
            {
              "text": "舞台窗口",
              "target": "tour_stage"
            },
            {
              "text": "扩展工坊",
              "target": "tour_ext"
            },
            {
              "text": "守卫工坊",
              "target": "tour_guard"
            },
            {
              "text": "回主线菜单",
              "target": "start"
            },
            {
              "text": "离席（终幕）",
              "target": "end"
            }
          ]
        }
      ]
    },
    {
      "id": "tour_av",
      "kind": "flow",
      "commands": [
        {
          "op": "say",
          "text": "声光餐车——音频四通道与视频族；通道状态写 SSOT，随快照/存档/回溯随行。",
          "speaker": "灵泛"
        },
        {
          "op": "stop_bgm",
          "fade": 600
        },
        {
          "op": "say",
          "text": "主线 BGM 淡出（stop_bgm）——给环境音让位。"
        },
        {
          "op": "ambient",
          "resource": "Audio/crickets_night01.mp3",
          "volume": 0.4,
          "loop": true
        },
        {
          "op": "say",
          "text": "环境音起（ambient）：蟋蟀夜声。"
        },
        {
          "op": "stop_ambient"
        },
        {
          "op": "say",
          "text": "环境音停（stop_ambient）。"
        },
        {
          "op": "voice",
          "resource": "Audio/chest_drawer_open.mp3",
          "auto_stop": true
        },
        {
          "op": "say",
          "text": "voice 通道——推进后 auto_stop 自动停；也可显式 stop_voice 收尾。"
        },
        {
          "op": "stop_voice"
        },
        {
          "op": "video_skipable",
          "value": true
        },
        {
          "op": "video",
          "resource": "Video/m1.mp4",
          "volume": 0.5
        },
        {
          "op": "say",
          "text": "视频非阻塞播放中（video）——对话照常推进。"
        },
        {
          "op": "pause_video"
        },
        {
          "op": "say",
          "text": "视频已暂停（pause_video）。"
        },
        {
          "op": "resume_video"
        },
        {
          "op": "seek_video",
          "seconds": 4
        },
        {
          "op": "wait",
          "seconds": 1.5,
          "skipable": true
        },
        {
          "op": "stop_video"
        },
        {
          "op": "say",
          "text": "恢复播放 + seek 到 4 秒，然后 stop_video 收尾。"
        },
        {
          "op": "menu",
          "prompt": "下一道？",
          "options": [
            {
              "text": "变量盛宴",
              "target": "tour_vars"
            },
            {
              "text": "流程厨房",
              "target": "tour_flow"
            },
            {
              "text": "存档试吃",
              "target": "tour_save"
            },
            {
              "text": "声光餐车",
              "target": "tour_av"
            },
            {
              "text": "舞台窗口",
              "target": "tour_stage"
            },
            {
              "text": "扩展工坊",
              "target": "tour_ext"
            },
            {
              "text": "守卫工坊",
              "target": "tour_guard"
            },
            {
              "text": "回主线菜单",
              "target": "start"
            },
            {
              "text": "离席（终幕）",
              "target": "end"
            }
          ]
        }
      ]
    },
    {
      "id": "tour_stage",
      "kind": "flow",
      "commands": [
        {
          "op": "say",
          "text": "舞台窗口——背景 op、对话窗三态、打字机开关与整块动画。",
          "speaker": "灵泛"
        },
        {
          "op": "background",
          "resource": "Images/lingfan.png"
        },
        {
          "op": "say",
          "text": "background op 已换背景（区别于元素层 bg_switch 的同类能力）。"
        },
        {
          "op": "window",
          "mode": "hide"
        },
        {
          "op": "notify",
          "text": "对话窗已隐藏（window hide）——此刻画面只剩这条 notify，点击继续。",
          "type": "info"
        },
        {
          "op": "say",
          "text": "（这句话在窗口隐藏期间上屏——你看不见它才算对。）"
        },
        {
          "op": "window",
          "mode": "show"
        },
        {
          "op": "say",
          "text": "对话窗回来了（window show）。"
        },
        {
          "op": "show",
          "target": "Images/lingfan.png",
          "id": "tour_block",
          "x": 180,
          "y": 120
        },
        {
          "op": "animate_block",
          "target": "tour_block",
          "x": 420,
          "y": 180,
          "opacity": 0.8,
          "duration": 1.2,
          "easing": "EaseOutQuad"
        },
        {
          "op": "say",
          "text": "animate_block：位置与透明度整块缓动。"
        },
        {
          "op": "text_typewriter",
          "enabled": false
        },
        {
          "op": "say",
          "text": "这句是瞬间上屏的（text_typewriter 关）。"
        },
        {
          "op": "text_typewriter",
          "enabled": true,
          "speed": 30
        },
        {
          "op": "say",
          "text": "打字机恢复（30 字/秒）。"
        },
        {
          "op": "hide",
          "target": "tour_block"
        },
        {
          "op": "menu",
          "prompt": "下一道？",
          "options": [
            {
              "text": "变量盛宴",
              "target": "tour_vars"
            },
            {
              "text": "流程厨房",
              "target": "tour_flow"
            },
            {
              "text": "存档试吃",
              "target": "tour_save"
            },
            {
              "text": "声光餐车",
              "target": "tour_av"
            },
            {
              "text": "舞台窗口",
              "target": "tour_stage"
            },
            {
              "text": "扩展工坊",
              "target": "tour_ext"
            },
            {
              "text": "守卫工坊",
              "target": "tour_guard"
            },
            {
              "text": "回主线菜单",
              "target": "start"
            },
            {
              "text": "离席（终幕）",
              "target": "end"
            }
          ]
        }
      ]
    },
    {
      "id": "tour_ext",
      "kind": "flow",
      "commands": [
        {
          "op": "say",
          "text": "扩展工坊——quest 是自定义 op（extensions/demo-quest.ts），全链路声明制。",
          "speaker": "灵泛"
        },
        {
          "step": "接取委托",
          "op": "quest"
        },
        {
          "op": "say",
          "text": "quest 已写入进度：{ext.demoquest.step}（ext.<id>. 命名空间，进 SSOT）。"
        },
        {
          "step": "完成交付",
          "op": "quest"
        },
        {
          "op": "say",
          "text": "再进一步：{ext.demoquest.step}。"
        },
        {
          "op": "say",
          "text": "链路 = 清单声明 extensions → stories:build 构建期放行校验 → 宿主装载注册 → 运行期分发。"
        },
        {
          "op": "menu",
          "prompt": "下一道？",
          "options": [
            {
              "text": "变量盛宴",
              "target": "tour_vars"
            },
            {
              "text": "流程厨房",
              "target": "tour_flow"
            },
            {
              "text": "存档试吃",
              "target": "tour_save"
            },
            {
              "text": "声光餐车",
              "target": "tour_av"
            },
            {
              "text": "舞台窗口",
              "target": "tour_stage"
            },
            {
              "text": "扩展工坊",
              "target": "tour_ext"
            },
            {
              "text": "守卫工坊",
              "target": "tour_guard"
            },
            {
              "text": "回主线菜单",
              "target": "start"
            },
            {
              "text": "离席（终幕）",
              "target": "end"
            }
          ]
        }
      ]
    },
    {
      "id": "tour_guard",
      "kind": "flow",
      "commands": [
        {
          "op": "say",
          "text": "守卫工坊——实现住在本源文件的 cell 槽位里，build 提取进 fun_register.g.ts，宿主零手写注册。",
          "speaker": "灵泛"
        },
        {
          "op": "set",
          "key": "tour.open",
          "value": true
        },
        {
          "op": "guard",
          "fn": "tour-open"
        },
        {
          "op": "say",
          "text": "guard(tourOpen) 通过——守卫读的是 SSOT 事实（tour.open）；handle 引用让名字只写一次（声明点即引用点）。"
        },
        {
          "op": "notify",
          "text": "写错守卫名？构建期名字闸门直接拦下（fail-closed 带列定位）。",
          "type": "info"
        },
        {
          "op": "say",
          "text": "两层执法各管各的：类型化名字管 IDE 补全；构建期闸门管真实拦截（tsx 不查类型）；运行期未注册 = guard-unknown 停机兜底。"
        },
        {
          "op": "menu",
          "prompt": "下一道？",
          "options": [
            {
              "text": "变量盛宴",
              "target": "tour_vars"
            },
            {
              "text": "流程厨房",
              "target": "tour_flow"
            },
            {
              "text": "存档试吃",
              "target": "tour_save"
            },
            {
              "text": "声光餐车",
              "target": "tour_av"
            },
            {
              "text": "舞台窗口",
              "target": "tour_stage"
            },
            {
              "text": "扩展工坊",
              "target": "tour_ext"
            },
            {
              "text": "守卫工坊",
              "target": "tour_guard"
            },
            {
              "text": "回主线菜单",
              "target": "start"
            },
            {
              "text": "离席（终幕）",
              "target": "end"
            }
          ]
        }
      ]
    }
  ]
}
