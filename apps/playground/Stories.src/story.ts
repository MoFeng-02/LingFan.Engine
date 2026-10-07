/**
 * TS 故事源（源约定：本目录顶层**恰好一个** .ts，default 导出多列 Story）。
 *
 * 本故事用 **Script 词汇层写法**（与对象字面量写法同故事、同语义）：
 * 作者词汇来自 `@lingfan/editor` 的 `script` 命名空间——say/menu/when/assert/guard
 * 一行一个，底层 StoryCommand 形状知识收敛进词汇层（编辑器包）。
 *
 * 分界：
 * - TS 原生 if / for / 函数 = **构建期**（分支展开成静态数据、循环展开成批量列）
 * - 运行期分支/循环/校验 = 词汇层结构化构造（whenChain / assert / guard——
 *   产物为 if-op / assert-op / guard-op 节点，回溯与存档全兼容）
 */
import type { ElementNode, Story, StoryColumn, StoryCommand } from "@lingfan/engine";
import { script } from "@lingfan/editor";

const {
  defineVars,
  expr,
  cond,
  say,
  option,
  menu,
  input,
  notify,
  nvl,
  character,
  bgm,
  se,
  stopBgm,
  ambient,
  stopAmbient,
  voice,
  stopVoice,
  video,
  cutscene,
  seekVideo,
  pauseVideo,
  resumeVideo,
  stopVideo,
  videoSkipable,
  set,
  letVar,
  undef,
  newArray,
  arrayPush,
  arrayPop,
  dict,
  dictSet,
  random,
  whileDo,
  forIn,
  forEach,
  switchOn,
  breakLoop,
  continueLoop,
  navigate,
  autoSave,
  save,
  saveDelete,
  whenChain,
  wait,
  jump,
  assert,
  guard,
  cell,
  extOp,
  sceneSetup,
  textElement,
  buttonElement,
  show,
  animate,
  animateBlock,
  style,
  setZ,
  shake,
  transition,
  hide,
  bgSwitch,
  background,
  dialogWindow,
  textTypewriter,
  minigame,
  reward,
} = script;

// —— 显式变量注册（变量句柄先登记后引用——IDE 补全 + 拼写检查） ——
const vars = defineVars({
  "player.gold": "num",
  "player.name": "str",
  n: "num",
  m: "num",
  dice: "num",
});

// —— 具名实现槽位（cell）：构建期扫描进 fun_register.g.ts，故事里 guard(handle) 引用 ——
// 参数类型由 cell 签名语境推断（GuardFn），无需注记；实现里只能引用导入绑定/参数/全局。
const checkGold = cell("gold-non-negative", (ctx) => {
  const gold = ctx.get("player.gold");
  if (typeof gold !== "number" || gold < 0) ctx.fail(`player.gold 非法：${String(gold)}`);
});
// 巡礼守卫：站点自带的闸门演示（先 set 状态再 guard——守卫读的是 SSOT 事实）
const tourOpen = cell("tour-open", (ctx) => {
  if (ctx.get("tour.open") !== true) ctx.fail("巡礼尚未开始（tour.open 未置位）");
});

// —— 构建期常量：去处清单（菜单选项由此生成） ——
const PLACES = [
  { id: "inn", label: "酒馆" },
  { id: "square", label: "广场" },
  { id: "stage_demo", label: "元素舞台" },
  { id: "ts_power", label: "TS 能力" },
  { id: "tour", label: "词汇全席" },
] as const;

// —— 构建期开关：教学列由清单条件生成（关掉 = 产物里没有这一列） ——
const 包含教学列 = PLACES.some((p) => p.id === "ts_power");

// —— 第一章：序幕（bgm / 插值 / input / if+func / wait / NVL / cutscene / 守卫 / 菜单） ——
const 开场列: StoryColumn = {
  sourcePath: "Stories/chapter1/chapter1.story",
  id: "start",
  kind: "flow",
  commands: [
    bgm("Audio/crickets_night01.mp3", { volume: 0.4, fade: 1200 }),
    set("player.gold", "+= {20}"),
    character("灵泛", { name: "灵泛", color: "#7aa2f7" }),
    // 迁移保真：原手写列带 z:2000（插值句在最上层）
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
    // 运行期守卫（实现在上方 cell 槽位——build 提取进 fun_register.g.ts，宿主 import 装配）
    guard(checkGold),
    menu("接下来去哪里？", PLACES.map((p) => option(p.label, p.id))),
  ],
};

// —— 第一章：酒馆 ——
const 酒馆列: StoryColumn = {
  sourcePath: "Stories/chapter1/chapter1.story",
  id: "inn",
  kind: "flow",
  commands: [say("欢迎光临，{player.gold} 金币的贵客！", "酒馆老板"), jump("end")],
};

// —— 第二章：广场（do-while 热身 + minigame） ——
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
const 广场列: StoryColumn = {
  id: "square",
  sourcePath: "Stories/chapter2/chapter2.story",
  kind: "flow",
  commands: 广场命令,
};

// —— 第二章：元素舞台（sceneSetup 复合词 + 递归容器 + for 装饰行） ——
const 装饰行: ElementNode[] = [1, 2, 3].map((i) =>
  textElement(`提示 ${i}：元素也是数据——这一行由构建期 for 生成`, {
    id: `hint_${i}`,
    y: `${56 + i * 8}%`,
    color: "#565f89",
    size: 14,
  }),
);
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
const 舞台列: StoryColumn = {
  sourcePath: "Stories/chapter2/chapter2.story",
  id: "stage_demo",
  kind: "scene",
  elements: 舞台元素,
  entry: [
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
};

// —— 第三章：TS 能力教学 + 尾声 ——
const 能力清单: ReadonlyArray<string> = [
  "interface / enum / as const —— 类型即文档",
  "函数注入 —— helpers 与词汇层构建器（词汇表单点）",
  "for / while / do-while —— 重复结构构建期展开成静态数据",
  "递归 / 泛型 —— 容器元素树与重复生成器",
  "构建期条件 —— 本列由 PLACES 清单条件生成",
  "模板字符串 —— 文案可插构建期常量",
  "运行期语义仍由引擎 op 承载（whenChain/whileDo/random 显式种子）⇒ 回溯 / 存档全兼容",
];
const 教学列: StoryColumn = {
  sourcePath: "Stories/chapter3/chapter3.story",
  id: "ts_power",
  kind: "flow",
  commands: [
    say("这一列由 TS 构建期条件生成——下面的清单就是本源文件用到的能力：", "灵泛"),
    ...能力清单.map((条目, 序号) => say(`${序号 + 1}. ${条目}`)),
    assert(expr`${vars["player.gold"]} >= 0`, "金币不能为负"),
    say("源文件在 Stories.src/——改完跑 stories:build（或开 watch），再重进本工程可见。"),
    jump("end"),
  ],
};
const 尾声列: StoryColumn = {
  sourcePath: "Stories/chapter3/chapter3.story",
  id: "end",
  kind: "flow",
  commands: [
    say("本列播完——列尾之后点击不再推进。", "灵泛"),
    say("（这条结局列也是 TS 源的一员：所有 jump/menu 的目标都在同一份类型安全的数据里。）"),
  ],
};

// —— 第四章：词汇全席（每站一个词汇域；菜单由构建期站点清单生成） ——
const TOUR_PATH = "Stories/chapter4/vocab_tour.story";

/** 巡礼站点（构建期常量：加一站 = 加一行 + 一个列草稿，菜单自动长出选项） */
const 巡礼站点: ReadonlyArray<{ readonly id: string; readonly label: string }> = [
  { id: "tour_vars", label: "变量盛宴" },
  { id: "tour_flow", label: "流程厨房" },
  { id: "tour_save", label: "存档试吃" },
  { id: "tour_av", label: "声光餐车" },
  { id: "tour_stage", label: "舞台窗口" },
  { id: "tour_ext", label: "扩展工坊" },
  { id: "tour_guard", label: "守卫工坊" },
];

/** 全席菜单（各站复用同一份选项面——站点/出口改这里，全部站同步） */
const 巡礼菜单 = (): StoryCommand =>
  menu("下一道？", [
    ...巡礼站点.map((s) => option(s.label, s.id)),
    option("回主线菜单", "start"),
    option("离席（终幕）", "end"),
  ]);

const 全席列: StoryColumn = {
  sourcePath: TOUR_PATH,
  id: "tour",
  kind: "flow",
  commands: [
    say("词汇全席开席——每个站点把一个词汇域做成一道菜，随便点、随便续。", "灵泛"),
    say("（本列由 TS 源第四章生成：站点清单是构建期常量，菜单选项由 map 生成。）"),
    巡礼菜单(),
  ],
};

const 变量站: StoryColumn = {
  sourcePath: TOUR_PATH,
  id: "tour_vars",
  kind: "flow",
  commands: [
    say("变量盛宴——数组、字典、临时变量都是 SSOT 状态，随快照/存档/回溯随行。", "灵泛"),
    newArray("bag", ["火把"]),
    // 构建期 map 生成三连 push（改清单即改故事——运行期只看见静态 op 序列）
    ...["面包", "旧地图", "提灯"].map((item) => arrayPush("bag", item)),
    say("行囊就绪：array 建列 + 构建期 map 生成三次 array_push（火把、面包、旧地图、提灯）。"),
    arrayPop("bag"),
    say("array_pop 取走最后一件（提灯）——现在剩三件。"),
    dict("gear", { weapon: "木剑", armor: "布衣" }),
    dictSet("gear", "weapon", "铁剑"),
    say("装备字典：dict 建档 + dict_set 把武器从木剑升级成铁剑（历史面板可查每次变更）。"),
    letVar("ticket", 1),
    say("let 临时变量：ticket = {ticket}。"),
    undef("ticket"),
    say("undef 已把 ticket 从变量表回收（这句故意不再插值它）。"),
    巡礼菜单(),
  ],
};

const 流程站: StoryColumn = {
  sourcePath: TOUR_PATH,
  id: "tour_flow",
  kind: "flow",
  commands: [
    say("流程厨房——随机、多路分支、循环与循环控制全是运行期 op（显式种子 ⇒ 回溯确定性）。", "灵泛"),
    random(2026, 1, 6, "dice"),
    say("掷骰（种子 2026，回溯重放同点数）：{dice} 点。"),
    // switch 用例由构建期数组生成：1 与 6 有专属台词，其余落 default
    switchOn(
      "{dice}",
      [
        [1, [say("一点——运气垫底，正适合从头再来。")]],
        [6, [say("六点——大吉！今晚酒钱我出。")]],
      ],
      [say("{dice} 点，中规中矩。")],
    ),
    set("n", 0),
    whileDo(cond`${vars.n} < 3`, [
      set("n", "+= {1}"),
      whenChain(cond`${vars.n} == 2`, [continueLoop()]).else([
        say(`报数 {n}（while + continue：2 被跳过）`),
      ]),
    ]),
    set("m", 0),
    whileDo("{m < 99}", [
      set("m", "+= {1}"),
      whenChain(cond`${vars.m} >= 3`, [breakLoop()]).else([
        say(`冲刺 {m}（break 在 3 收步）`),
      ]),
    ]),
    newArray("supplies", ["火把", "面包", "旧地图"]),
    forIn("item", "{supplies}", [say(`for 迭代：{item}`)]),
    forEach("thing", "supplies", [say(`foreach 迭代：{thing}`)]),
    say("两站同料双炊：for 吃表达式、foreach 按名取集合——产物都是静态 op 序列。"),
    say("本站用 navigate 回菜单（导航清屏，区别于 jump 的原地跳）。"),
    navigate("tour"),
  ],
};

const 存档站: StoryColumn = {
  sourcePath: TOUR_PATH,
  id: "tour_save",
  kind: "flow",
  commands: [
    say("存档试吃——存档编排归引擎命令面、安全归 Rust；故事只按名声明。", "灵泛"),
    autoSave(true),
    say("auto_save 已开启：从现在起每个等待画面都会自动落检查点档。"),
    save("tour_slot", "词汇全席·存档试吃"),
    say("本句上屏时「存档试吃」档已写入 tour_slot（save op 在等待画面落档）——右上角「读」可随时回来。"),
    save("temp_demo"),
    say("临时档 temp_demo 也写了一份（纯演示用）。"),
    saveDelete("temp_demo"),
    say("save_delete 已删掉临时档——tour_slot 不受影响。"),
    notify("存档域演示完毕：试试右上角「存 / 读」。", { type: "success" }),
    巡礼菜单(),
  ],
};

const 声光站: StoryColumn = {
  sourcePath: TOUR_PATH,
  id: "tour_av",
  kind: "flow",
  commands: [
    say("声光餐车——音频四通道与视频族；通道状态写 SSOT，随快照/存档/回溯随行。", "灵泛"),
    stopBgm({ fade: 600 }),
    say("主线 BGM 淡出（stop_bgm）——给环境音让位。"),
    ambient("Audio/crickets_night01.mp3", { volume: 0.4, loop: true }),
    say("环境音起（ambient）：蟋蟀夜声。"),
    stopAmbient(),
    say("环境音停（stop_ambient）。"),
    voice("Audio/chest_drawer_open.mp3", { autoStop: true }),
    say("voice 通道——推进后 auto_stop 自动停；也可显式 stop_voice 收尾。"),
    stopVoice(),
    videoSkipable(true),
    video("Video/m1.mp4", { volume: 0.5 }),
    say("视频非阻塞播放中（video）——对话照常推进。"),
    pauseVideo(),
    say("视频已暂停（pause_video）。"),
    resumeVideo(),
    seekVideo(4),
    wait(1.5, { skipable: true }),
    stopVideo(),
    say("恢复播放 + seek 到 4 秒，然后 stop_video 收尾。"),
    巡礼菜单(),
  ],
};

const 舞台站: StoryColumn = {
  sourcePath: TOUR_PATH,
  id: "tour_stage",
  kind: "flow",
  commands: [
    say("舞台窗口——背景 op、对话窗三态、打字机开关与整块动画。", "灵泛"),
    background("Images/lingfan.png"),
    say("background op 已换背景（区别于元素层 bg_switch 的同类能力）。"),
    dialogWindow("hide"),
    notify("对话窗已隐藏（window hide）——此刻画面只剩这条 notify，点击继续。", { type: "info" }),
    say("（这句话在窗口隐藏期间上屏——你看不见它才算对。）"),
    dialogWindow("show"),
    say("对话窗回来了（window show）。"),
    show("Images/lingfan.png", { id: "tour_block", x: 180, y: 120 }),
    animateBlock("tour_block", {
      x: 420,
      y: 180,
      opacity: 0.8,
      duration: 1.2,
      easing: "EaseOutQuad",
    }),
    say("animate_block：位置与透明度整块缓动。"),
    textTypewriter({ enabled: false }),
    say("这句是瞬间上屏的（text_typewriter 关）。"),
    textTypewriter({ enabled: true, speed: 30 }),
    say("打字机恢复（30 字/秒）。"),
    hide("tour_block"),
    巡礼菜单(),
  ],
};

const 扩展站: StoryColumn = {
  sourcePath: TOUR_PATH,
  id: "tour_ext",
  kind: "flow",
  commands: [
    say("扩展工坊——quest 是自定义 op（extensions/demo-quest.ts），全链路声明制。", "灵泛"),
    extOp("quest", { step: "接取委托" }),
    say("quest 已写入进度：{ext.demoquest.step}（ext.<id>. 命名空间，进 SSOT）。"),
    extOp("quest", { step: "完成交付" }),
    say("再进一步：{ext.demoquest.step}。"),
    say("链路 = 清单声明 extensions → stories:build 构建期放行校验 → 宿主装载注册 → 运行期分发。"),
    巡礼菜单(),
  ],
};

const 守卫站: StoryColumn = {
  sourcePath: TOUR_PATH,
  id: "tour_guard",
  kind: "flow",
  commands: [
    say("守卫工坊——实现住在本源文件的 cell 槽位里，build 提取进 fun_register.g.ts，宿主零手写注册。", "灵泛"),
    set("tour.open", true),
    guard(tourOpen),
    say("guard(tourOpen) 通过——守卫读的是 SSOT 事实（tour.open）；handle 引用让名字只写一次（声明点即引用点）。"),
    notify("写错守卫名？构建期名字闸门直接拦下（fail-closed 带列定位）。", { type: "info" }),
    say("两层执法各管各的：类型化名字管 IDE 补全；构建期闸门管真实拦截（tsx 不查类型）；运行期未注册 = guard-unknown 停机兜底。"),
    巡礼菜单(),
  ],
};

// —— 组装 + 构建期自检（重复 id / 入口缺失在 parseStory 之前 fail-fast） ——
const 列草稿集: StoryColumn[] = [
  开场列,
  酒馆列,
  广场列,
  舞台列,
  ...(包含教学列 ? [教学列] : []),
  尾声列,
  全席列,
  变量站,
  流程站,
  存档站,
  声光站,
  舞台站,
  扩展站,
  守卫站,
];
const 列id集 = new Set(列草稿集.map((草稿) => 草稿.id));
if (列id集.size !== 列草稿集.length) {
  throw new Error("构建期自检失败：列 id 重复");
}
const 入口id = "start";
if (!列id集.has(入口id)) {
  throw new Error(`构建期自检失败：入口列 ${入口id} 不存在`);
}

export default {
  formatVersion: 1,
  id: "demo",
  entry: 入口id,
  // 迁移保真：原清单 defines（player.gold 初始 7）——漏写会在 serialize 时被抹掉
  defines: { "player.gold": 7 },
  columns: 列草稿集,
} satisfies Story;
