/**
 * 步骤视图接线
 *
 * 与 `tests/playground/webview-guard.test.ts` 同手法（`?raw` 源级结构断言）：
 * 本任务的价值在「接线是否真的接上」与「有没有另立一套边界判定」，
 * 而这两件事在组件行为测试里不可见（Vue 组件不在 vitest 的 DOM 环境内）。
 */
import { describe, expect, it } from "vitest";
import appSource from "../../apps/editor/src/App.vue?raw";
import stepLayoutSource from "../../apps/editor/src/components/StepLayout.vue?raw";
import editorApiContractSource from "../../apps/editor/src/contracts/editor.ts?raw";
import stepsSource from "../../packages/editor/src/layout/steps.ts?raw";
import editorIndexSource from "../../packages/editor/src/index.ts?raw";
import engineIndexSource from "../../packages/engine/src/index.ts?raw";

describe("视图接线：centerView 四态 + 步骤分支", () => {
  it("centerView 联合类型含 'step'，默认仍为 timeline", () => {
    expect(appSource).toContain(
      'ref<"timeline" | "stage" | "graph" | "step">("timeline")',
    );
  });

  it("工具栏有「步骤」入口（点击切到 step）", () => {
    expect(appSource).toContain("@click=\"centerView = 'step'\"");
  });

  it("中心区按 centerView 渲染 StepLayout", () => {
    expect(appSource).toContain('v-else-if="centerView === \'step\'"');
    expect(appSource).toContain("<StepLayout");
  });

  it("防回退：NodeGraph 分支必须是 v-else-if（裸 v-else 会把步骤视图吃掉）", () => {
    expect(appSource).toContain('v-else-if="centerView === \'graph\'"');
    expect(appSource).not.toMatch(/<NodeGraph\s+v-else[\s>]/);
  });

  it("四个中心视图全被 v-if / v-else-if 链覆盖（无「掉到空」的分支）", () => {
    for (const view of ["timeline", "stage", "graph", "step"]) {
      expect(appSource).toContain(`centerView === '${view}'`);
    }
  });
});

describe("点击步骤 → 定位时间线（验收③，零新增管道）", () => {
  it("StepLayout 注入既有 editorApi 并调用 `api.reveal`（定位职责已显式化）", () => {
    expect(stepLayoutSource).toContain("inject(EDITOR_API_KEY)");
    // 拆职责前靠 `select()` 的切视图副作用顺带实现定位；
    //    现已显式化为 `reveal()` = 选中 + 切时间线 + 滚动到行。
    //    本断言守的是「点步骤能定位到时间线」这个**意图**，不是"必须调 select"这个字面。
    expect(stepLayoutSource).toContain("api.reveal(step.endPointer)");
    // 契约面必须声明 reveal（注入键的类型即取自这份契约）
    expect(editorApiContractSource).toMatch(/interface\s+EditorApiPort\s*\{[^}]*reveal\(/);
  });

  it("泳道头走既有 selectColumn（与节点图同语义）", () => {
    expect(stepLayoutSource).toContain("api.selectColumn(lane.columnId)");
  });
});

describe("单一事实源：边界判定只来自引擎的等待声明表（不得在编辑器另立一套）", () => {
  it("引擎侧导出等待声明表与取值函数", () => {
    expect(engineIndexSource).toContain("WAITING_OPS");
    expect(engineIndexSource).toContain("waitingStateOfOp");
    expect(engineIndexSource).toContain("waitSpecOfOp");
  });

  it("步骤算法从 @lingfan/engine 取等待事实（消费而非复制判定）", () => {
    expect(stepsSource).toContain('from "@lingfan/engine"');
    expect(stepsSource).toContain("waitingStateOfOp");
    expect(stepsSource).toContain("waitSpecOfOp");
    // 不得在本模块私自声明等待 op 表（那会成为第二份定义）
    expect(stepsSource).not.toMatch(/const\s+\w*WAITING_OPS/);
  });

  it("编辑器公共出口导出步骤模块（显式名单，漏一处即运行时取不到）", () => {
    for (const name of ["storySteps", "columnSteps", "StoryStep"]) {
      expect(editorIndexSource).toContain(name);
    }
  });

  it("blocks 体遍历复用既有描述符递归（walkCommandBodies），不新造块体字段知识", () => {
    expect(stepsSource).toContain("walkCommandBodies");
    expect(editorIndexSource).toContain("walkCommandBodies");
  });
});

describe("派生视图约定：步骤视图不记忆布局（无 localStorage）", () => {
  it("StepLayout 不引 localStorage（记忆布局即第二份状态）", () => {
    expect(stepLayoutSource).not.toContain("localStorage");
  });

  it("布局是确定性派生的（storySteps computed，无外部状态参与）", () => {
    expect(stepLayoutSource).toContain("storySteps(props.story)");
  });
});

describe("泳道几何：同层泳道必须纵向依次排开（曾出现过重叠）", () => {
  it("按层分组 + 累加 y（不是所有泳道共用同一个 y）", () => {
    // 回归：初版把同层多条泳道都画在同一个 y 上（层内重叠、相互盖住）。
    // 断言「按 layer 分桶」与「y 累加」两个动作都在实现里。
    expect(stepLayoutSource).toContain("byLayer");
    expect(stepLayoutSource).toMatch(/y \+= height \+ GAP_Y/);
  });

  it("步骤盒位置由泳道盒推导（含泳道头高度），而不是固定 PAD", () => {
    expect(stepLayoutSource).toMatch(
      /\(box\?\.y \?\? PAD\) \+ HEADER_H \+ stepIndex \* \(STEP_H \+ GAP_Y\)/,
    );
  });
});