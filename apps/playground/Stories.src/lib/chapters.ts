/**
 * 第一至三章主线：序幕 / 酒馆 / 广场 / 元素舞台 / 教学 / 尾声——六个列，外加去处清单
 * `PLACES` 与教学列开关。列以 `列草稿`（作者视图）声明、经 `建列` 落成引擎契约。
 */
import type { ElementNode, StoryColumn } from "@lingfan/engine";
import {
  animate,
  assert,
  bgm,
  bgSwitch,
  buttonElement,
  character,
  cutscene,
  expr,
  guard,
  hide,
  input,
  jump,
  menu,
  minigame,
  notify,
  nvl,
  option,
  reward,
  say,
  sceneSetup,
  se,
  set,
  shake,
  show,
  style,
  setZ,
  textElement,
  transition,
  wait,
  whenChain,
  地点,
  vars,
} from "./vocabulary";
import { checkGold } from "./cells";
import { 建列, 重复 } from "./language-showcase";

/** 构建期常量：去处清单——主线菜单选项由它生成；label 是选项文案，id 必须与列 id 对齐（menu 的跳转目标）。 */
const PLACES = [
  { id: 地点.酒馆, label: "酒馆" },
  { id: 地点.广场, label: "广场" },
  { id: 地点.元素舞台, label: "元素舞台" },
  { id: 地点.TS能力, label: "TS 能力" },
  { id: "tour", label: "词汇全席" },
] as const;

/** 构建期开关：教学列是否进产物。false = 产物里没有这一列，不产生空列。 */
export const 包含教学列 = PLACES.some((p) => p.id === 地点.TS能力);

/** 第一章序幕列：bgm / 插值 / input / whenChain+func / wait / NVL / cutscene / 守卫 / 菜单，一章内集中亮相。 */
export const 开场列: StoryColumn = 建列({
  id: "start",
  kind: "flow",
  sourcePath: "Stories/chapter1/chapter1.story",
  命令: [
    bgm("Audio/crickets_night01.mp3", { volume: 0.4, fade: 1200 }),
    set("player.gold", "+= {20}"),
    character("灵泛", { name: "灵泛", color: "#7aa2f7" }),
    // z:2000 把插值句垫到最上层——列内其他元素（背景、人物）都压在它下面
    {
      op: "say",
      text: "你有 {player.gold:000} 枚金币（插值 + 补零格式化）。",
      speaker: "灵泛",
      z: 2000,
    },
    say("富文本：{b}加粗{/b}、{i}斜体{/i}、{u}下划线{/u}、{color=#FFD700}金色{/color}、{color=#9ece6a}{size=22}大字{/size}{/color}。"),
    input("旅人，报上名来：", "player.name"),
    whenChain(expr`${vars["player.gold"]} >= 25`, [
      notify("金币充足！当前 {player.gold} 枚。", { type: "info" }),
      {
        op: "func",
        name: "greet",
        params: ["who"],
        body: [{ op: "say", speaker: "{who}", text: "{who}，欢迎来到灵泛！" }],
      },
      { op: "call", target: "greet", args: ["{player.name}"] },
    ]).else([say("囊中羞涩……先去赚点钱吧。")]),
    wait(1.5, { skipable: true }),
    say("（等待 1.5 秒可点击跳过）"),
    se("Audio/chest_drawer_open.mp3", { volume: 0.7 }),
    nvl("enter"),
    // 构建期 map：NVL 三段由数组生成（要改文案改数组，不改结构）
    ...["NVL 累积：第一段。", "第二段（滚动累积）。", "第三段。"].map((t) => say(t)),
    nvl("exit"),
    say("NVL 退出，回到普通对话。"),
    cutscene("Video/m1.mp4", { volume: 0.8, skipable: true, z: 1450 }),
    say("过场结束——播完或点击跳过都会继续。"),
    // 运行期守卫（实现在 lib/cells.ts 的 cell 槽位——build 提取进 fun_register.g.ts，宿主 import 装配）
    guard(checkGold),
    menu("接下来去哪里？", PLACES.map((p) => option(p.label, p.id))),
  ],
});

/** 第一章酒馆列：老板一句招呼后直接跳列尾（end）收束。 */
export const 酒馆列: StoryColumn = 建列({
  id: "inn",
  kind: "flow",
  sourcePath: "Stories/chapter1/chapter1.story",
  命令: [say("欢迎光临，{player.gold} 金币的贵客！", "酒馆老板"), jump("end")],
});

/** 第二章广场列的命令流：构建期 do-while 生成热身三行，接 click3 小游戏（通关金币 +10）。 */
const 广场命令 = [
  // 构建期 do-while：热身三行（展开符不能少——否则数组嵌数组，parseStory fail-closed）
  ...(() => {
    const lines = [];
    let 组 = 0;
    do {
      组 += 1;
      lines.push(say(`热身第 ${组} 组：甩了甩手腕（构建期 do-while 生成）。`, "旁白"));
    } while (组 < 3);
    return lines;
  })(),
  say("广场上只有风声。"),
  minigame("click3", {
    config: { target: 3 },
    reward: [reward("player.gold", 10)],
  }),
  say("你活动了一下手腕（小游戏演示完成，金币 +10）。"),
  jump("end"),
];
/** 第二章广场列：内容即上面的 广场命令；sourcePath 指向第二章故事文件。 */
export const 广场列: StoryColumn = 建列({
  id: "square",
  kind: "flow",
  sourcePath: "Stories/chapter2/chapter2.story",
  命令: 广场命令,
});

/** 舞台装饰行：由 重复 构建期生成三行提示元素，id 与纵坐标随序号变化。 */
const 装饰行: ElementNode[] = 重复(3, (序号) => {
  const i = 序号 + 1;
  return textElement(`提示 ${i}：元素也是数据——这一行由构建期 for 生成`, {
    id: `hint_${i}`,
    y: `${56 + i * 8}%`,
    color: "#565f89",
    size: 14,
  });
});
/** 舞台场景元素清单：sceneSetup 复合词铺背景与标题，panel 容器演示递归 children（按钮 + 装饰行）。 */
const 舞台元素: ElementNode[] = [
  ...sceneSetup("Images/lingfan.png", "元素系统 · 最小闭环", {
    bgOpacity: 0.35,
    titleSize: 34,
    titleColor: "#FFD700",
  }),
  {
    type: "panel",
    id: "box",
    x: "5%",
    y: "32%",
    width: "90%",
    spacing: 12,
    zindex: 20,
    children: [
      textElement("容器内子元素（panel → children）", { color: "#9ece6a" }),
      buttonElement("回到故事", { id: "btn_back", nav: "start" }),
      ...装饰行,
    ],
  } satisfies ElementNode,
];
/** 第二章元素舞台列（scene）：元素清单 + 入口命令流，依次演示 show / animate / style / setZ / shake / transition / bgSwitch。 */
export const 舞台列: StoryColumn = 建列({
  id: "stage_demo",
  kind: "scene",
  sourcePath: "Stories/chapter2/chapter2.story",
  元素: 舞台元素,
  入口: [
    say("这里是元素舞台——背景、标题、容器与按钮都是声明式元素。", "灵泛"),
    say("点击后依次执行：追加元素 → 淡入动画 → 样式与层级调整 → 屏幕震动 → 全屏转场。"),
    show("Images/lingfan.png", { id: "hero", name: "cast", x: 40, y: 120, background: false }),
    animate("hero", "opacity", 0.9, { duration: 1, easing: "EaseOutQuad" }),
    style("title", { color: "#9ece6a" }),
    setZ("title", 30),
    shake({ intensity: 6, duration: 0.4 }),
    transition("fade", 0.6),
    say("完成：标题已改绿、层级已提升，追加的图已淡入。"),
    hide("cast"),
    say("按 name 批量隐藏（cast 组）已完成，可看到图消失。"),
    bgSwitch("Images/lingfan.png"),
    say("背景已切换（bg_switch）。回「开始故事」列可继续。"),
  ],
});

/** 第三章教学列的清单文案：逐条对应本源用到的构建期能力；渲染时拼序号，运行期是静态数据。 */
const 能力清单: ReadonlyArray<string> = [
  "interface / enum / as const —— 类型即文档",
  "函数注入 —— helpers 与词汇层构建器（词汇表单点）",
  "for / while / do-while —— 重复结构构建期展开成静态数据",
  "递归 / 泛型 —— 容器元素树与重复生成器",
  "构建期条件 —— 本列由 PLACES 清单条件生成",
  "模板字符串 —— 文案可插构建期常量",
  "运行期语义仍由引擎 op 承载（whenChain/whileDo/random 显式种子）⇒ 回溯 / 存档全兼容",
];
/** 第三章 TS 能力教学列：能力清单逐条 say + assert 收尾；是否进产物由 包含教学列 开关决定。 */
export const 教学列: StoryColumn = 建列({
  id: "ts_power",
  kind: "flow",
  sourcePath: "Stories/chapter3/chapter3.story",
  命令: [
    say("这一列由 TS 构建期条件生成——下面的清单就是本源文件用到的能力：", "灵泛"),
    ...能力清单.map((条目, 序号) => say(`${序号 + 1}. ${条目}`)),
    assert(expr`${vars["player.gold"]} >= 0`, "金币不能为负"),
    say("源文件在 Stories.src/——改完跑 stories:build（或开 watch），再重进本工程可见。"),
    jump("end"),
  ],
});
/** 尾声列（id: end）：全库 jump("end") 的落点；列尾之后点击不再推进。 */
export const 尾声列: StoryColumn = 建列({
  id: "end",
  kind: "flow",
  sourcePath: "Stories/chapter3/chapter3.story",
  命令: [
    say("本列播完——列尾之后点击不再推进。", "灵泛"),
    say("（这条结局列也是 TS 源的一员：所有 jump/menu 的目标都在同一份类型安全的数据里。）"),
  ],
});
