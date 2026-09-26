/** 编辑器初始示例故事（新建/首开用）：小而全——say/变量/分支体/菜单跳转 */
import type { Story } from "@lingfan/engine";

export function sampleStory(): Story {
  return {
    formatVersion: 1,
    id: "editor-demo",
    entry: "start",
    lang: "zh",
    defines: { "player.gold": 10 },
    columns: [
      {
        id: "start",
        kind: "flow",
        commands: [
          { op: "say", text: "欢迎打开灵泛编辑器。", speaker: "向导" },
          { op: "set", key: "player.gold", value: 10 },
          {
            op: "if",
            cond: "{player.gold >= 10}",
            then: [{ op: "say", text: "你带着盘缠。", template: "center" }],
            else: [{ op: "say", text: "你身无分文。" }],
          },
          {
            op: "menu",
            prompt: "去哪里？",
            options: [
              { text: "酒馆", target: "inn" },
              { text: "广场", target: "square" },
              { text: "舞台", target: "stage" },
            ],
          },
        ],
      },
      {
        id: "inn",
        kind: "flow",
        commands: [
          { op: "bgm", resource: "Audio/inn.mp3", volume: 0.4, loop: true },
          { op: "say", text: "酒馆里暖烘烘的。", voice: "Audio/inn_line.ogg" },
          { op: "jump", target: "end" },
        ],
      },
      {
        id: "square",
        kind: "flow",
        commands: [
          { op: "say", text: "广场上只有风声。" },
          { op: "navigate", path: "end" },
        ],
      },
      {
        // 08 §二.1 scene 列（声明式空间层）：切「舞台」视图可拖拽元素定位
        id: "stage",
        kind: "scene",
        elements: [
          {
            type: "background",
            id: "bg",
            source: "Images/bg.png",
            x: 0,
            y: 0,
            width: "100%",
            height: "100%",
            opacity: 0.6,
          },
          {
            type: "text",
            id: "title",
            text: "灵泛编辑器 · 舞台",
            x: 40,
            y: 60,
            width: 360,
            size: 32,
            color: "#FFD700",
            halign: "center",
            zindex: 10,
          },
          {
            type: "panel",
            id: "box",
            x: 40,
            y: 140,
            width: 320,
            direction: "vertical",
            spacing: 10,
            children: [
              { type: "text", text: "容器内子元素（panel → children）" },
              { type: "button", id: "btn", text: "回到 start", nav: "start" },
            ],
          },
        ],
        entry: [
          { op: "window", mode: "auto" },
          {
            op: "show",
            target: "Images/hero.png",
            id: "hero",
            name: "cast",
            x: 400,
            y: 200,
          },
          {
            op: "animate",
            target: "hero",
            property: "opacity",
            value: 0.9,
            duration: 1,
            easing: "EaseOutQuad",
          },
          { op: "say", text: "scene 列：元素是声明式空间层，可在舞台视图拖拽。" },
        ],
      },
      { id: "end", kind: "flow", commands: [{ op: "say", text: "（完）" }] },
    ],
  };
}
