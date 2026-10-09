/**
 * **执行器门面测试**（源级互锁）。
 *
 * 结构口径：
 *   命令处理器（`exec*` 自由函数）住在运行层的处理器域，分发 `switch` 住在 `dispatch.ts`，
 *   `engine.ts` 只留门面：public 方法、组装、以及对处理器与内部机制的同名同签名转发。
 *
 * 为什么需要源级断言：
 *   把 `exec*` 实现体搬回门面**不会**让任何行为断言变红——行为逐字相同，只有源码文本不同。
 *   本文件真读源文本并计数，并对检测器本身做自检，避免写成恒真式（匹配不到任何东西却永远绿）。
 */
import { describe, expect, it } from "vitest";

// ---------- 引擎源码（前端不碰文件系统，改用打包器读取） ----------

/** 运行层全部源码，键 = 仓库相对路径 */
const RUNTIME_SOURCES = import.meta.glob(
  "../../../packages/engine/src/runtime/**/*.ts",
  {
    eager: true,
    query: "?raw",
    import: "default",
  },
) as Record<string, string>;

const ENGINE_FILE = Object.keys(RUNTIME_SOURCES).find((file) =>
  file.endsWith("/runtime/engine.ts"),
);

/**
 * `exec` 实现体的全部声明写法。
 *
 * 三者的共同点：**声明**才有的前缀（访问修饰符 / 返回类型标注 / `function` / `const`），
 * 调用语句一个都不占——所以检测器不会把 `execSay(this.ctx, …)` 这类调用误判成实现体。
 */
const EXEC_DECLARATIONS: readonly RegExp[] = [
  // 类成员方法（带访问修饰符）：`private execSay(frame: Frame, cmd: StoryCommand): void {`
  /(?:^|\n)\s*(?:private|protected|public)\s+(?:async\s+)?(exec[A-Za-z0-9_]*)\s*\(/g,
  // 类成员方法（无修饰符，靠两格缩进 + 返回类型标注区分于调用）：`  execSay(...): void {`
  /(?:^|\n) {2}(exec[A-Za-z0-9_]*)\s*\([^)]*\)\s*:/g,
  // 顶层函数：`export function execAudio(ctx: OpContext, cmd: StoryCommand): boolean {`
  /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+(exec[A-Za-z0-9_]*)\s*\(/g,
  // 绑定字段：`const execSay = (…): void => {`
  /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+(exec[A-Za-z0-9_]*)\s*[:=]/g,
];

/** 收集源码里 `exec` 实现体的名字（去重，保持出现顺序） */
function execImplementationBodies(source: string): string[] {
  const found: string[] = [];
  for (const pattern of EXEC_DECLARATIONS) {
    for (const match of source.matchAll(pattern)) {
      const name = match[1]!;
      if (!found.includes(name)) found.push(name);
    }
  }
  return found;
}

/** 取 `engine.ts` 源文本（找不到就直接红：源码列举本身失效不算通过） */
function engineSource(): string {
  expect(ENGINE_FILE, "运行层源码里应有 engine.ts").toBeDefined();
  return RUNTIME_SOURCES[ENGINE_FILE!]!;
}

describe("StoryEngine 门面：源级互锁", () => {
  it("检测器自检：实现体声明必被命中，调用语句不算", () => {
    // 历史形态（曾写在门面里的私有方法）必须命中——否则下面的「计数为 0」毫无意义
    expect(
      execImplementationBodies(
        "  private execSay(frame: Frame, cmd: StoryCommand): void {\n",
      ),
    ).toEqual(["execSay"]);
    // 处理器域的自由函数形态同样命中
    expect(
      execImplementationBodies(
        "export function execAudio(ctx: OpContext, cmd: StoryCommand): boolean {\n",
      ),
    ).toEqual(["execAudio"]);
    // 无修饰符的成员方法（两格缩进 + 返回类型）命中
    expect(
      execImplementationBodies("  execNotify(cmd: StoryCommand): void {\n"),
    ).toEqual(["execNotify"]);
    // 调用语句一个都不许命中
    expect(
      execImplementationBodies("      return execSay(this.ctx, frame, cmd);\n"),
    ).toEqual([]);
    expect(
      execImplementationBodies("  execSay(this.ctx, frame, cmd);\n"),
    ).toEqual([]);
    expect(execImplementationBodies("  const spec = makeAnimation(…);\n")).toEqual(
      [],
    );
  });

  it("门面内 `exec` 实现体计数为 0（处理器只能住在处理器域）", () => {
    const source = engineSource();
    // 空集恒真式防护：源文本必须真读到门面本体
    expect(source.length).toBeGreaterThan(1000);
    expect(source).toContain("class StoryEngine");
    expect(execImplementationBodies(source)).toEqual([]);
  });

  it("分发 `switch` 的唯一归属是 dispatch.ts（门面内零残留）", () => {
    const owners = Object.entries(RUNTIME_SOURCES)
      .filter(([, source]) => source.includes("switch (cmd.op) {"))
      .map(([file]) => file);
    expect(owners).toHaveLength(1);
    expect(owners[0]).toMatch(/\/runtime\/dispatch\.ts$/);
    expect(engineSource()).not.toContain("switch (cmd.op) {");
  });
});
