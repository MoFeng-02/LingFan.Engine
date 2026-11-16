/**
 * core/script 负载边界：空/全可选负载、null 归属、块体混排、嵌套 spec 形状。
 *
 * 类型面只锁结构等价；数值范围/非空/正则等运行期约束归校验器
 * （editor schema），此处不重复断言运行期拒绝。
 */
import { describe, expect, it } from "vitest";
import type {
  CommandOf,
  ScriptBody,
  StateScriptValue,
} from "@lingfan-engine/core/script";

describe("core/script · 负载边界", () => {
  it("全可选负载：return 裸 op 合法；value:null 必须红", () => {
    const bare: CommandOf<"return"> = { op: "return" };
    expect(bare.op).toBe("return");
    // @ts-expect-error null 只属状态槽，return 值不收 null
    const nullValue: CommandOf<"return"> = { op: "return", value: null };
    void nullValue;
  });

  it("null 归属：状态槽收 null；call args 不收", () => {
    const state: CommandOf<"set"> = { op: "set", key: "tmp", value: null };
    const slot: StateScriptValue = null;
    expect(state.value).toBeNull();
    expect(slot).toBeNull();
    // @ts-expect-error args 元素是 ScriptValue，不含 null
    const args: CommandOf<"call"> = { op: "call", target: "fn", args: [null] };
    void args;
  });

  it("可选字段接受显式 undefined（仓库未开 exactOptionalPropertyTypes）", () => {
    const cmd: CommandOf<"say"> = {
      op: "say",
      text: "你好",
      speaker: undefined,
    };
    expect(cmd.text).toBe("你好");
  });

  it("ScriptBody = unknown[]：内置/扩展/非命令值可混排（嵌套校验归校验器）", () => {
    const body: ScriptBody = [
      { op: "say", text: "内置" },
      { op: "demoquest.step", step: 1 },
      42,
    ];
    const branch: CommandOf<"if"> = { op: "if", cond: "{flag}", then: body };
    expect(branch.then).toHaveLength(3);
  });

  it("menu 选项与 input 候选形状不同，互串必须红", () => {
    const menu: CommandOf<"menu"> = {
      op: "menu",
      options: [{ text: "前进", target: "next" }],
    };
    const input: CommandOf<"input"> = {
      op: "input",
      prompt: "名字",
      store: "player.name",
      options: [{ text: "张三", value: "张三" }],
    };
    expect(menu.options[0]?.target).toBe("next");
    expect(input.options?.[0]?.value).toBe("张三");
    const badMenu: CommandOf<"menu"> = {
      op: "menu",
      // @ts-expect-error menu 选项无 value 字段（且缺 target）
      options: [{ text: "前进", value: "next" }],
    };
    const badInput: CommandOf<"input"> = {
      op: "input",
      prompt: "名字",
      store: "s",
      // @ts-expect-error input 候选无 target 字段（且缺 value）
      options: [{ text: "张三", target: "x" }],
    };
    void badMenu;
    void badInput;
  });

  it("空负载：break/continue 裸 op 合法；任何字段必须红", () => {
    const brk: CommandOf<"break"> = { op: "break" };
    const cont: CommandOf<"continue"> = { op: "continue" };
    expect(brk.op).toBe("break");
    expect(cont.op).toBe("continue");
    const extra: CommandOf<"break"> = {
      op: "break",
      // @ts-expect-error 空负载特判产 { op: K }，不收任何字段
      seconds: 1,
    };
    void extra;
  });

  it("random：range 是精确二元组；seed 的 int 约束归校验器", () => {
    const ok: CommandOf<"random"> = {
      op: "random",
      seed: 42,
      range: [1, 6],
      var: "dice",
    };
    expect(ok.range).toEqual([1, 6]);
    // 类型面不收窄：非整 seed 可赋值（int 是运行期约束）
    const fractional: CommandOf<"random"> = {
      op: "random",
      seed: 1.5,
      range: [0, 1],
      var: "d",
    };
    void fractional;
    const short: CommandOf<"random"> = {
      op: "random",
      seed: 1,
      // @ts-expect-error 一元组不是二元组
      range: [1],
      var: "d",
    };
    const long: CommandOf<"random"> = {
      op: "random",
      seed: 1,
      // @ts-expect-error 三元组不是二元组
      range: [1, 2, 3],
      var: "d",
    };
    void short;
    void long;
  });

  it("switch：case value 是 ScriptValue（null/对象必须红），body 是块体", () => {
    const ok: CommandOf<"switch"> = {
      op: "switch",
      on: "{state}",
      cases: [{ value: 1, body: [{ op: "say", text: "一" }] }],
      default: [],
    };
    expect(ok.cases).toHaveLength(1);
    const nullCase: CommandOf<"switch"> = {
      op: "switch",
      on: "{state}",
      cases: [
        {
          // @ts-expect-error case value 不收 null（被求值走 ScriptValue）
          value: null,
          body: [],
        },
      ],
    };
    const objCase: CommandOf<"switch"> = {
      op: "switch",
      on: "{state}",
      cases: [
        {
          // @ts-expect-error case value 不收对象
          value: { a: 1 },
          body: [],
        },
      ],
    };
    void nullCase;
    void objCase;
  });

  it("null 归属（域 A）：array/dict/array_push 收 null；func params 不收", () => {
    const arr: CommandOf<"array"> = {
      op: "array",
      key: "inventory",
      items: ["sword", null],
    };
    const pushed: CommandOf<"array_push"> = {
      op: "array_push",
      key: "inventory",
      value: null,
    };
    const dic: CommandOf<"dict"> = {
      op: "dict",
      key: "stats",
      value: { hp: 100, mp: null },
    };
    expect(arr.items[1]).toBeNull();
    expect(pushed.value).toBeNull();
    expect(dic.value.mp).toBeNull();
    const badParams: CommandOf<"func"> = {
      op: "func",
      name: "f",
      // @ts-expect-error params 元素是 string，不收 null
      params: [null],
      body: [],
    };
    void badParams;
  });

  it("guard args 是运输面：嵌套 JSON（含 null/数组/对象）类型面合法", () => {
    const cmd: CommandOf<"guard"> = {
      op: "guard",
      fn: "hasItem",
      args: { item: "key", nested: { deep: [1, null, { x: true }] } },
    };
    expect(cmd.fn).toBe("hasItem");
  });

  it("nvl mode 是字面量联合；notify type 是宽 string（窄联合留作者侧）", () => {
    const nvl: CommandOf<"nvl"> = { op: "nvl", mode: "enter" };
    expect(nvl.mode).toBe("enter");
    const notify: CommandOf<"notify"> = {
      op: "notify",
      text: "提示",
      type: "custom-kind",
    };
    expect(notify.type).toBe("custom-kind");
    const badMode: CommandOf<"nvl"> = {
      op: "nvl",
      // @ts-expect-error mode 只收 enter/auto/clear/exit
      mode: "bogus",
    };
    void badMode;
  });

  it("save slot 类型面是宽 string（SlotName 正则归校验器）；块体混排", () => {
    const save: CommandOf<"save"> = { op: "save", slot: "任意槽名" };
    expect(save.slot).toBe("任意槽名");
    const fn: CommandOf<"func"> = {
      op: "func",
      name: "f",
      params: ["x"],
      body: [
        { op: "say", text: "内置" },
        { op: "demoquest.step", step: 1 },
        42,
      ],
    };
    expect(fn.body).toHaveLength(3);
  });

  it("空负载（域 B）：pause_video/resume_video/stop_video 裸 op 合法；任何字段必须红", () => {
    const pause: CommandOf<"pause_video"> = { op: "pause_video" };
    const resume: CommandOf<"resume_video"> = { op: "resume_video" };
    const stop: CommandOf<"stop_video"> = { op: "stop_video" };
    expect(pause.op).toBe("pause_video");
    expect(resume.op).toBe("resume_video");
    expect(stop.op).toBe("stop_video");
    const extra: CommandOf<"stop_video"> = {
      op: "stop_video",
      // @ts-expect-error 空负载特判产 { op: K }，不收任何字段
      fade: 1,
    };
    void extra;
  });

  it("audio 通道枚举：四通道字面量合法，越界必须红；pause/resume/stop 可裸 op", () => {
    const play: CommandOf<"audio_play"> = {
      op: "audio_play",
      inst: "rain",
      channel: "ambient",
      resource: "audio/rain.ogg",
    };
    expect(play.channel).toBe("ambient");
    const pauseBare: CommandOf<"audio_pause"> = { op: "audio_pause" };
    const resumeBare: CommandOf<"audio_resume"> = { op: "audio_resume" };
    const stopBare: CommandOf<"audio_stop"> = { op: "audio_stop" };
    expect(pauseBare.op).toBe("audio_pause");
    expect(resumeBare.op).toBe("audio_resume");
    expect(stopBare.op).toBe("audio_stop");
    const badChannel: CommandOf<"audio_play"> = {
      op: "audio_play",
      inst: "rain",
      // @ts-expect-error channel 只收 bgm/se/ambient/voice
      channel: "music",
      resource: "audio/rain.ogg",
    };
    void badChannel;
  });

  it("show x/y 是 number|string 联合：两态合法，boolean/对象必须红", () => {
    const px: CommandOf<"show"> = {
      op: "show",
      target: "npc",
      x: 100,
      y: 200,
    };
    const css: CommandOf<"show"> = {
      op: "show",
      target: "npc",
      x: "30%",
      y: "40%",
    };
    expect(px.x).toBe(100);
    expect(css.y).toBe("40%");
    const badX: CommandOf<"show"> = {
      op: "show",
      target: "npc",
      // @ts-expect-error x 不收 boolean
      x: true,
    };
    const badY: CommandOf<"show"> = {
      op: "show",
      target: "npc",
      // @ts-expect-error y 不收对象
      y: { top: 0 },
    };
    void badX;
    void badY;
  });

  it("minigame reward/config 值面：reward 不收 null；config 收嵌套 JSON；interaction 无 reward", () => {
    const game: CommandOf<"minigame"> = {
      op: "minigame",
      game: "cook",
      config: { difficulty: 2, tags: ["a", null], nested: { ok: true } },
      reward: [{ key: "coin", value: "+= 20" }],
    };
    expect(game.game).toBe("cook");
    const badReward: CommandOf<"minigame"> = {
      op: "minigame",
      game: "cook",
      reward: [
        {
          key: "coin",
          // @ts-expect-error reward value 是 ScriptValue，不收 null
          value: null,
        },
      ],
    };
    const inter: CommandOf<"interaction"> = {
      op: "interaction",
      system: "walk",
      config: { speed: 3 },
    };
    expect(inter.system).toBe("walk");
    const rewardOnInter: CommandOf<"interaction"> = {
      op: "interaction",
      system: "walk",
      // @ts-expect-error interaction 无 reward 字段（小游戏专属）
      reward: [{ key: "coin", value: 1 }],
    };
    void badReward;
    void rewardOnInter;
  });

  it("mount props 收嵌套 JSON、visible 必填；style props 值不收 null", () => {
    const mounted: CommandOf<"mount"> = {
      op: "mount",
      name: "hub",
      visible: true,
      props: { scene: "forest", nested: { list: [1, null] } },
    };
    expect(mounted.visible).toBe(true);
    const badVisible: CommandOf<"mount"> = {
      op: "mount",
      name: "hub",
      // @ts-expect-error visible 必须是 boolean
      visible: "yes",
    };
    const styled: CommandOf<"style"> = {
      op: "style",
      target: "npc",
      props: { opacity: 0.5, label: "hi", flag: true },
    };
    expect(styled.target).toBe("npc");
    const badStyle: CommandOf<"style"> = {
      op: "style",
      target: "npc",
      props: {
        // @ts-expect-error props 值是 ScriptValue，不收 null
        opacity: null,
      },
    };
    void badVisible;
    void badStyle;
  });

  it("video/seek 运行期约束类型面不收窄：负 seconds / 非整 volume 合法（min/finite 归校验器）", () => {
    const seek: CommandOf<"seek_video"> = { op: "seek_video", seconds: -5 };
    const vid: CommandOf<"video"> = {
      op: "video",
      resource: "v.mp4",
      volume: 1.5,
    };
    expect(seek.seconds).toBe(-5);
    expect(vid.volume).toBe(1.5);
    const badSeconds: CommandOf<"seek_video"> = {
      op: "seek_video",
      // @ts-expect-error seconds 必须是 number
      seconds: "3",
    };
    void badSeconds;
  });
});
