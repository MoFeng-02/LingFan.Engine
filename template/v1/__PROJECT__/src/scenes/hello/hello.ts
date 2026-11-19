/**
 * 示例身体（原生形态）：一个列的「身体」就是这段工厂造出来的那一屏。
 *
 * 它演示三件事，正好对应身体的三条纪律：
 * 1. **局部状态是组件自己的**——点击计数存在闭包里，换列 / 回溯把它重挂时就归零；
 *    它不进存档，引擎也不记得它。想让一个事实「玩家看得见、存档记得住」，要走第 2 条。
 * 2. **玩家可见的事实落引擎状态**——点「点名」用 `env.submit` 提交一条 `say`，
 *    台词进引擎、对话层读得到、存档与回溯都带着它。组件不持有引擎，只经 `env` 写。
 * 3. **读引擎状态走订阅 + 现读**——`env.onChange` 只给「变过了」的信号，数据从
 *    `env.get` / `env.currentColumn` 现读，不在组件里囤一份会过期的副本。
 *
 * 入参里的 `env` 由身体层注入（故事值 `bodyProps` 与它合并）；`greeting` 是故事给的
 * JSON 安全入参。第二参 `controls` 是宿主控制面，本示例用不到，留着不接。
 */
import type { SceneEnv } from "@lingfan-engine/core";

/** 工厂产物：一个节点 + 一个拆除钩子（订阅、定时器都在这里停掉） */
interface HelloInstance {
  element: HTMLElement;
  dispose(): void;
}

export default function hello(
  props: Readonly<Record<string, unknown>>,
): HelloInstance {
  const env = props.env as SceneEnv;
  const greeting =
    typeof props.greeting === "string" ? props.greeting : "你好，旅人";

  // 局部状态：只活在这一次挂载里
  let clicks = 0;

  const root = document.createElement("div");
  root.className = "scene-hello";

  const title = document.createElement("h2");
  title.textContent = greeting;
  root.appendChild(title);

  const columnLine = document.createElement("p");
  root.appendChild(columnLine);

  const countLine = document.createElement("p");
  root.appendChild(countLine);

  const renderCount = (): void => {
    countLine.textContent = `这一屏里点了 ${clicks} 次（换列就归零）`;
  };
  const renderColumn = (): void => {
    columnLine.textContent = `当前列：${env.currentColumn()}`;
  };
  renderCount();
  renderColumn();

  const callButton = document.createElement("button");
  callButton.type = "button";
  callButton.textContent = "点名（写进引擎）";
  callButton.setAttribute("aria-label", "点名：把一句台词写进引擎状态");
  callButton.addEventListener("click", () => {
    clicks += 1;
    renderCount();
    // 玩家可见的事实落引擎状态：提交一条 say，对话层与存档都读得到
    env.submit([{ op: "say", text: `${greeting}（第 ${clicks} 次点名）` }]);
  });
  root.appendChild(callButton);

  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.textContent = "返回标题";
  backButton.setAttribute("aria-label", "返回标题列");
  backButton.addEventListener("click", () => {
    env.navigate("title_main");
  });
  root.appendChild(backButton);

  // 订阅只拿「变过了」的信号，数据现读——不在组件里囤副本
  const stop = env.onChange(() => {
    renderColumn();
  });

  return {
    element: root,
    dispose(): void {
      stop();
    },
  };
}
