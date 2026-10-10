/**
 * 步骤布局：把每列切分为「步骤」序列（步骤 = 等待态边界），并给出列间分支边。
 *
 * **步骤语义归引擎**：哪个 op 建立等待一律取自引擎的等待声明表
 * （`waitingStateOfOp` / `waitSpecOfOp`），本模块**不含任何逐 op 判定**——它只做结构切分：
 * 「一条命令是否构成边界」= 该命令自身或其可触达体内存在等待点。
 *
 * 块体与调用（两条规则都直接派生自引擎的检查点坐标语义 `checkpointCoord`：
 * 块帧内的等待点，坐标回退到**块进入命令**，故边界落在块命令本身）：
 * - 块体（if/while/for/foreach/switch）内含等待 ⇒ 该块命令即边界；块体内部不再另切步骤
 *   （同一次等待只算一步）；
 * - `call` 到「体含等待」的函数 ⇒ 该 `call` 即边界（函数体的等待确实在调用处建立检查点）；
 *   `func` **定义体不执行**，故 `func` 命令自身不是边界、其体也不参与切分与出边。
 *
 * 列尾若无等待点，剩余命令成一步 `kind: "exit"`（流程出口步）。
 * 容器与块体字段的遍历复用编辑器既有单点：`walkCommandBodies`（表单描述符递归），
 * 函数体解析用 `indexStory` 的函数索引（指针 → `getAtPointer`）。
 */
import type {
  Story,
  StoryColumn,
  WaitingState,
} from "@lingfan/engine";
import { waitSpecOfOp, waitingStateOfOp } from "@lingfan/engine";
import { getAtPointer } from "../editing";
import { indexStory } from "../diagnostics";
import { BUILTIN_OP_SURFACE, type OpSurface } from "../schema";
import { walkCommandBodies } from "../schema";
import { isPlainObject } from "../shared";

/** 步骤出边（分叉来源）：菜单选项 / 跳转 / 导航 */
export interface StepFork {
  kind: "menu" | "jump" | "navigate";
  /** 目标列 id */
  target: string;
  /** 菜单选项文案（jump/navigate 无） */
  label?: string;
  /** 产生该出边的字段指针 */
  pointer: string;
}

/** 一个步骤：一组连续命令，以等待点收尾（或列尾出口） */
export interface StoryStep {
  columnId: string;
  /** 列内步序（自 0 起） */
  index: number;
  /** wait = 以等待点收尾；exit = 列尾无等待点的流程出口 */
  kind: "wait" | "exit";
  /** 收尾等待态（exit 步为 "none"） */
  waiting: WaitingState;
  /** 硬等待（如 `pause`：不随时间/点击推进） */
  hard: boolean;
  /** 首个成员命令指针 */
  startPointer: string;
  /** 末个成员命令指针（点击定位用） */
  endPointer: string;
  /** 成员命令指针（列内**顶层**命令，有序——与时间线行一一对应） */
  commands: string[];
  /** 该步可触达的列间出边（含块体与被调函数体内的转移） */
  forks: StepFork[];
}

/** 一条泳道 = 一列 */
export interface StepLane {
  columnId: string;
  columnIndex: number;
  kind: "flow" | "scene";
  steps: StoryStep[];
  /** scene 列的元素数（元素是声明式空间层，**不计入步骤**，仅作泳道徽标） */
  elementCount: number;
  /** BFS 分层（自入口列起；未达列归末层） */
  layer: number;
}

/** 步骤间连边（自某步到目标列首步） */
export interface StepEdge {
  fromColumnId: string;
  /** 源列内步序 */
  fromStep: number;
  toColumnId: string;
  kind: "menu" | "jump" | "navigate";
  label?: string;
  pointer: string;
}

export interface StepLayout {
  lanes: StepLane[];
  edges: StepEdge[];
  /** 列内无步骤（空列）或步骤数，按列 id 索引——便于视图头部显示徽标 */
  stepCounts: Map<string, number>;
}

export interface StepOptions {
  /** op 合并面（扩展注册后由组合根传入；缺省 = 内建） */
  surface?: OpSurface;
}

function opOf(cmd: unknown): string | undefined {
  return isPlainObject(cmd) && typeof cmd.op === "string" ? cmd.op : undefined;
}

/** 可触达命令的收集上下文（函数索引 + 防环栈） */
interface ReachContext {
  story: Story;
  functions: Map<string, { pointer: string }>;
  surface: OpSurface;
}

/**
 * 收集一条命令**可直接触达**的命令（自身 + 块体；`call` 追进被调函数体；`func` 定义体不追）。
 * 返回列表含每条可触达命令的指针，供边界判定与出边收集共用（同一次遍历产两个事实）。
 */
function collectReachable(
  cmd: unknown,
  pointer: string,
  ctx: ReachContext,
  out: { cmd: Record<string, unknown>; pointer: string }[],
  callStack: Set<string>,
): void {
  if (!isPlainObject(cmd)) return;
  out.push({ cmd, pointer });
  const op = opOf(cmd);
  if (op === undefined) return;
  if (op === "func") return; // 定义体不执行
  if (op === "call") {
    const name = typeof cmd.target === "string" ? cmd.target : "";
    if (name === "" || callStack.has(name)) return; // 未知名 / 互为环：到此为止
    const entry = ctx.functions.get(name);
    if (entry === undefined) return;
    const definition = getAtPointer(ctx.story, entry.pointer);
    if (!isPlainObject(definition)) return;
    const body = definition.body;
    if (!Array.isArray(body)) return;
    callStack.add(name);
    body.forEach((child, index) => {
      collectReachable(
        child,
        `${entry.pointer}/body/${index}`,
        ctx,
        out,
        callStack,
      );
    });
    callStack.delete(name);
    return;
  }
  walkCommandBodies(
    cmd,
    pointer,
    (child, childPointer) => {
      collectReachable(child, childPointer, ctx, out, callStack);
    },
    ctx.surface,
  );
}

/** 出边收集：菜单选项（带文案）/ 跳转 / 导航；目标栏位名与引擎 `execNavigate` 同序（scene 优先） */
function collectForks(
  reachable: { cmd: Record<string, unknown>; pointer: string }[],
): StepFork[] {
  const forks: StepFork[] = [];
  for (const { cmd, pointer } of reachable) {
    const op = opOf(cmd);
    if (op === "menu" && Array.isArray(cmd.options)) {
      cmd.options.forEach((option, index) => {
        if (!isPlainObject(option)) return;
        if (typeof option.target !== "string" || option.target === "") return;
        forks.push({
          kind: "menu",
          target: option.target,
          label: typeof option.text === "string" ? option.text : undefined,
          pointer: `${pointer}/options/${index}/target`,
        });
      });
      continue;
    }
    if (op === "jump") {
      if (typeof cmd.target === "string" && cmd.target !== "") {
        forks.push({ kind: "jump", target: cmd.target, pointer: `${pointer}/target` });
      }
      continue;
    }
    if (op === "navigate") {
      const target =
        typeof cmd.scene === "string" && cmd.scene !== ""
          ? cmd.scene
          : typeof cmd.path === "string"
            ? cmd.path
            : "";
      if (target !== "") {
        forks.push({ kind: "navigate", target, pointer });
      }
    }
  }
  return forks;
}

/**
 * 列内步骤切分：非边界命令并入「开放步」；遇边界收步；列尾非空则产出口步。
 * 成员只含**顶层**命令指针（与时间线行一一对应）；边界判定才下探块体与函数体。
 */
export function columnSteps(
  story: Story,
  columnIndex: number,
  options?: StepOptions,
): StoryStep[] {
  const column: StoryColumn | undefined = story?.columns?.[columnIndex];
  if (column === undefined || column === null) return [];
  const columnId = typeof column.id === "string" ? column.id : "";
  // 命令容器：flow → commands；scene → entry（与 walkStoryCommands 同口径）
  const field: "commands" | "entry" =
    column.kind === "flow" ? "commands" : "entry";
  const list: unknown = field === "commands" ? column.commands : column.entry;
  if (!Array.isArray(list)) return [];

  const ctx: ReachContext = {
    story,
    functions: new Map(
      [...indexStory(story).functions].map(([name, entry]) => [
        name,
        { pointer: entry.pointer },
      ]),
    ),
    surface: options?.surface ?? BUILTIN_OP_SURFACE,
  };

  const steps: StoryStep[] = [];
  let open: string[] = [];
  let pendingForks: StepFork[] = [];
  const rootPointer = `/columns/${columnIndex}/${field}`;

  const close = (kind: StoryStep["kind"], spec: { state: WaitingState; hard: boolean; forks: StepFork[] }): void => {
    if (open.length === 0) return;
    steps.push({
      columnId,
      index: steps.length,
      kind,
      waiting: spec.state,
      hard: spec.hard,
      startPointer: open[0]!,
      endPointer: open[open.length - 1]!,
      commands: open,
      forks: spec.forks,
    });
    open = [];
    pendingForks = [];
  };

  list.forEach((cmd, index) => {
    const pointer = `${rootPointer}/${index}`;
    open.push(pointer);
    const reachable: { cmd: Record<string, unknown>; pointer: string }[] = [];
    collectReachable(cmd, pointer, ctx, reachable, new Set());
    pendingForks.push(...collectForks(reachable));
    // 边界 = 可触达集合里存在等待点（自身或块体/被调函数体）
    const boundary = reachable.find(
      (item) => waitingStateOfOp(opOf(item.cmd)) !== "none",
    );
    if (boundary !== undefined) {
      const spec = waitSpecOfOp(opOf(boundary.cmd));
      close("wait", {
        state: spec?.state ?? "wait",
        hard: spec?.hard === true,
        forks: pendingForks,
      });
    }
  });
  close("exit", { state: "none", hard: false, forks: pendingForks });
  return steps;
}

/** 列间边（源列 → 目标列）供泳道分层；目标可不存在（由诊断报 missing-target） */
function columnAdjacency(
  story: Story,
  options?: StepOptions,
): { ids: string[]; idSet: Set<string>; adjacency: Map<string, Set<string>> } {
  const ids = story.columns.map((c) => c.id);
  const idSet = new Set(ids);
  const adjacency = new Map<string, Set<string>>();
  for (const id of ids) adjacency.set(id, new Set());
  story.columns.forEach((_, index) => {
    const from = ids[index];
    if (from === undefined) return;
    for (const step of columnSteps(story, index, options)) {
      for (const fork of step.forks) {
        adjacency.get(from)?.add(fork.target);
      }
    }
  });
  return { ids, idSet, adjacency };
}

/**
 * 步骤布局总装：逐列切分（泳道）+ 汇总步骤间连边 + 自入口列 BFS 分层（环安全）。
 * 未达列（无入边的孤立列）归末层，保证全部列可见。
 */
export function storySteps(story: Story, options?: StepOptions): StepLayout {
  const { ids, idSet, adjacency } = columnAdjacency(story, options);

  const layerOf = new Map<string, number>();
  const queue: string[] = [];
  const root = idSet.has(story.entry) ? story.entry : ids[0];
  if (root !== undefined) {
    layerOf.set(root, 0);
    queue.push(root);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head]!;
    for (const next of adjacency.get(current) ?? []) {
      if (!layerOf.has(next)) {
        layerOf.set(next, layerOf.get(current)! + 1);
        queue.push(next);
      }
    }
  }
  const fallback = Math.max(0, ...layerOf.values()) + 1;
  for (const id of ids) if (!layerOf.has(id)) layerOf.set(id, fallback);

  const lanes: StepLane[] = story.columns.map((column, index) => {
    const steps = columnSteps(story, index, options);
    return {
      columnId: column.id,
      columnIndex: index,
      kind: column.kind === "flow" ? "flow" : "scene",
      steps,
      elementCount: Array.isArray(column.elements) ? column.elements.length : 0,
      layer: layerOf.get(column.id) ?? fallback,
    };
  });

  const edges: StepEdge[] = [];
  for (const lane of lanes) {
    for (const step of lane.steps) {
      for (const fork of step.forks) {
        if (!idSet.has(fork.target)) continue; // 悬空目标交诊断（视图不画幽灵边）
        edges.push({
          fromColumnId: lane.columnId,
          fromStep: step.index,
          toColumnId: fork.target,
          kind: fork.kind,
          label: fork.label,
          pointer: fork.pointer,
        });
      }
    }
  }

  const stepCounts = new Map<string, number>();
  for (const lane of lanes) stepCounts.set(lane.columnId, lane.steps.length);
  return { lanes, edges, stepCounts };
}