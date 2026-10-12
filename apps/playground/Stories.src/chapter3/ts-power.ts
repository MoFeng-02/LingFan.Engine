/**
 * 第三章 · TS 能力列：清单逐条对应 Stories.src 新范式源真实用到的能力，
 * assert 用引擎表达式文法做运行期断言收尾。
 */
import { assert, say } from "../lib/vocabulary";
import { jump } from "../lib/compile-time";

export default function ts_power(): void {
  say(
    "这一列由 TS 静态编译生成——下面的清单就是 Stories.src 用到的能力：",
    "灵泛",
  );
  say("1. interface / enum —— 类型即文档（enum 地点直接写成菜单选项）");
  say("2. 函数 —— 嵌套函数与跨文件导出函数，编译期前置 func + 调用点 call");
  say("3. if / else-if / else —— 编译为 when / whenChain 运行期分支");
  say(
    "4. while / for / for-of —— 编译为 whileDo / let+whileDo / for 运行期循环",
  );
  say("5. staticFor —— 编译期定数循环，展开为静态命令序列");
  say("6. switch —— 编译为 switchOn（case 体以 break 收尾，引擎无穿透）");
  say("7. 模板串与常量折叠 —— 文案插值与枚举/常量在构建期落成静态数据");
  say(
    "8. 运行期语义仍由引擎 op 承载（set/letVar/复合赋值）⇒ 回溯 / 存档全兼容",
  );
  assert("{player.gold >= 0}", "金币不能为负");
  say(
    "源文件在 Stories.src/——改完跑 stories:build（或开 watch），再重进本工程可见。",
  );
  jump("end");
}
