/**
 * 第四章：词汇全席——每站一个词汇域（变量 / 流程 / 存档 / 声光 / 舞台 / 扩展 / 守卫），
 * 菜单由构建期站点清单生成。列以 `列草稿` 声明、经 `建列` 落成引擎契约。
 */
import type { StoryColumn, StoryCommand } from "@lingfan/engine";
import {
  ambient,
  animateBlock,
  arrayPop,
  arrayPush,
  autoSave,
  background,
  breakLoop,
  cond,
  continueLoop,
  dialogWindow,
  dict,
  dictSet,
  extOp,
  forEach,
  forIn,
  guard,
  hide,
  letVar,
  menu,
  navigate,
  newArray,
  notify,
  option,
  pauseVideo,
  random,
  resumeVideo,
  save,
  saveDelete,
  say,
  seekVideo,
  set,
  show,
  stopAmbient,
  stopBgm,
  stopVideo,
  stopVoice,
  switchOn,
  textTypewriter,
  undef,
  vars,
  video,
  videoSkipable,
  voice,
  wait,
  whenChain,
  whileDo,
} from "./vocabulary";
import { tourOpen } from "./cells";
import { 建列 } from "./language-showcase";

/** 第四章故事文件路径：本章全部列共用同一 sourcePath；加一站 = 加一行清单 + 一个列草稿，菜单选项自动长出。 */
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

/** 全席列（id: tour）：主线菜单「词汇全席」的落点——开席两句 + 站点菜单（各站复用同一份选项面）。 */
export const 全席列: StoryColumn = 建列({
  id: "tour",
  kind: "flow",
  sourcePath: TOUR_PATH,
  命令: [
    say("词汇全席开席——每个站点把一个词汇域做成一道菜，随便点、随便续。", "灵泛"),
    say("（本列由 TS 源第四章生成：站点清单是构建期常量，菜单选项由 map 生成。）"),
    巡礼菜单(),
  ],
});

/** 变量站：数组 / 字典 / let / undef 一套演示——SSOT 状态随快照、存档、回溯随行。 */
export const 变量站: StoryColumn = 建列({
  id: "tour_vars",
  kind: "flow",
  sourcePath: TOUR_PATH,
  命令: [
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
});

/** 流程站：random / switchOn / whileDo / continueLoop / breakLoop / forIn / forEach 运行期流程 op 集中演示（显式种子保证回溯确定性）；站尾用 navigate 回菜单。 */
export const 流程站: StoryColumn = 建列({
  id: "tour_flow",
  kind: "flow",
  sourcePath: TOUR_PATH,
  命令: [
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
});

/** 存档站：autoSave 开关 + 命名档 save + 临时档 saveDelete 的时机演示（编排归引擎命令面，安全归 Rust）。 */
export const 存档站: StoryColumn = 建列({
  id: "tour_save",
  kind: "flow",
  sourcePath: TOUR_PATH,
  命令: [
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
});

/** 声光站：环境音 / voice / 视频族与对应停止 op 的成对演示；通道状态写 SSOT，随快照、存档、回溯随行。 */
export const 声光站: StoryColumn = 建列({
  id: "tour_av",
  kind: "flow",
  sourcePath: TOUR_PATH,
  命令: [
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
});

/** 舞台站：background 换背景、对话窗显隐、打字机开关与 animateBlock 整块缓动。 */
export const 舞台站: StoryColumn = 建列({
  id: "tour_stage",
  kind: "flow",
  sourcePath: TOUR_PATH,
  命令: [
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
});

/** 扩展站：extOp 调用自定义扩展 op（quest）——清单声明 → 构建期放行 → 宿主注册 → 运行期分发。 */
export const 扩展站: StoryColumn = 建列({
  id: "tour_ext",
  kind: "flow",
  sourcePath: TOUR_PATH,
  命令: [
    say("扩展工坊——quest 是自定义 op（extensions/demo-quest.ts），全链路声明制。", "灵泛"),
    extOp("quest", { step: "接取委托" }),
    say("quest 已写入进度：{ext.demoquest.step}（ext.<id>. 命名空间，进 SSOT）。"),
    extOp("quest", { step: "完成交付" }),
    say("再进一步：{ext.demoquest.step}。"),
    say("链路 = 清单声明 extensions → stories:build 构建期放行校验 → 宿主装载注册 → 运行期分发。"),
    巡礼菜单(),
  ],
});

/** 守卫站：guard(tourOpen) 演示具名守卫槽位——实现住 lib/cells.ts，构建期提取进 fun_register.g.ts，宿主零手写注册。 */
export const 守卫站: StoryColumn = 建列({
  id: "tour_guard",
  kind: "flow",
  sourcePath: TOUR_PATH,
  命令: [
    say("守卫工坊——实现住在本源文件的 cell 槽位里，build 提取进 fun_register.g.ts，宿主零手写注册。", "灵泛"),
    set("tour.open", true),
    guard(tourOpen),
    say("guard(tourOpen) 通过——守卫读的是 SSOT 事实（tour.open）；handle 引用让名字只写一次（声明点即引用点）。"),
    notify("写错守卫名？构建期名字闸门直接拦下（fail-closed 带列定位）。", { type: "info" }),
    say("两层执法各管各的：类型化名字管 IDE 补全；构建期闸门管真实拦截（tsx 不查类型）；运行期未注册 = guard-unknown 停机兜底。"),
    巡礼菜单(),
  ],
});
