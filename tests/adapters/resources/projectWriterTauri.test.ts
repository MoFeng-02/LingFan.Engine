/**
 * T03-01/T03-02 Tauri 写回适配器测试（锚点: project-writer-parity / project-write-conflict-detection）。
 *
 * 「契约层同一套测试用例在两个适配器上跑」的 TS 半边：invoke 替身按 Rust
 * `apply_project_files` / `stamp_project_files` 的**同语义**实现内存盘
 * （白名单 / 先写后删 / 幂等 / 指纹 = mtime+size），断言形状与
 * `directorySource.test.ts` 的 FSA 用例对齐；Rust 行为由 `project_writer.rs`
 * cargo 测试锁定。
 */

import { describe, expect, it } from "vitest";
import type { ProjectWriterPort } from "@lingfan/engine";
import { createTauriProjectWriter, type TauriInvoke } from "@lingfan/adapters";

/** invoke 替身：内存盘 + Rust 同语义（校验 → 指纹 → 写 → 删；调用序记录） */
function makeMemoryBackend() {
  const disk = new Map<string, { text: string; mtime: number }>();
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  const opLog: string[] = [];
  const invoke: TauriInvoke = async <T>(
    command: string,
    args?: Record<string, unknown>,
  ) => {
    calls.push({ command, args: args ?? {} });
    const { paths, changes, deletes } = (args ?? {}) as {
      paths?: string[];
      changes?: { path: string; text: string }[];
      deletes?: string[];
    };
    if (command === "stamp_project_files") {
      const stamps = (paths ?? [])
        .filter((path) => disk.has(path))
        .map((path) => ({
          path,
          lastModified: disk.get(path)!.mtime,
          size: disk.get(path)!.text.length,
        }));
      return { stamps } as T;
    }
    if (command === "apply_project_files") {
      // 同 Rust 白名单：写入 = project.json | Stories/**；删除 = 仅 Stories/**
      const writeOk = (p: string) =>
        p === "project.json" || (p.startsWith("Stories/") && !p.includes(".."));
      const deleteOk = (p: string) => p.startsWith("Stories/");
      for (const change of changes ?? []) {
        if (!writeOk(change.path)) {
          throw new Error(`写入路径非法（越出资源根或非白名单）：${change.path}`);
        }
      }
      for (const path of deletes ?? []) {
        if (!deleteOk(path)) {
          throw new Error(`删除路径非法（只允许删除 Stories/ 内的陈旧文件）：${path}`);
        }
      }
      for (const change of changes ?? []) {
        disk.set(change.path, { text: change.text, mtime: nextMtime() });
        opLog.push(`write ${change.path}`);
      }
      for (const path of deletes ?? []) {
        opLog.push(`delete ${path}`);
        disk.delete(path);
      }
      return {
        written: (changes ?? []).map((change) => change.path),
        deleted: [...(deletes ?? [])],
      } as T;
    }
    throw new Error(`未知命令：${command}`);
  };
  let mtime = 1000;
  const nextMtime = (): number => {
    mtime += 1;
    return mtime;
  };
  /** 外部程序写磁盘（绕过 writer：模拟他人改动——mtime 前进） */
  const externalWrite = (path: string, text: string): void => {
    disk.set(path, { text, mtime: nextMtime() + 10 });
  };
  const externalDelete = (path: string): void => {
    disk.delete(path);
  };
  const put = (path: string, text: string): void => {
    disk.set(path, { text, mtime: nextMtime() });
  };
  return { disk, calls, opLog, invoke, externalWrite, externalDelete, put };
}

function makeWriter(
  backend: ReturnType<typeof makeMemoryBackend>,
  previous: ReadonlyMap<string, string>,
): Promise<ProjectWriterPort> {
  return createTauriProjectWriter("E:/proj/Resources", previous, {
    invoke: backend.invoke,
  });
}

describe("createTauriProjectWriter（project-writer-parity / project-write-conflict-detection）", () => {
  it("拟态旅程：最小差量下 invoke（列先、清单后），内存盘与报告一致", async () => {
    const backend = makeMemoryBackend();
    backend.put("project.json", "{旧清单}");
    backend.put("Stories/old.json", "{旧列}");
    backend.put("Stories/keep.json", "{保持}");
    const writer = await makeWriter(
      backend,
      new Map([
        ["project.json", "{旧清单}"],
        ["Stories/old.json", "{旧列}"],
        ["Stories/keep.json", "{保持}"],
      ]),
    );

    const report = await writer.apply(
      // 真实链路的 wanted 序 = serializeProject 的码元序（Stories/* < project.json）
      new Map([
        ["Stories/keep.json", "{保持}"],
        ["Stories/new.json", "{新列}"],
        ["project.json", "{新清单}"],
      ]),
    );

    expect(report).toEqual({
      written: ["Stories/new.json", "project.json"],
      deleted: ["Stories/old.json"],
    });
    // 调用序不变量：列文件先于清单（提交点最后）、删除在全部写入之后
    expect(backend.opLog).toEqual([
      "write Stories/new.json",
      "write project.json",
      "delete Stories/old.json",
    ]);
    expect(backend.disk.get("Stories/new.json")?.text).toBe("{新列}");
    expect(backend.disk.get("project.json")?.text).toBe("{新清单}");
    expect(backend.disk.has("Stories/old.json")).toBe(false);
    expect(backend.disk.get("Stories/keep.json")?.text).toBe("{保持}"); // 未变化不重写
    // 跨边界字符串契约：命令名 + 参数键（root/changes/deletes，path/text）
    const applyCalls = backend.calls.filter(
      (call) => call.command === "apply_project_files",
    );
    expect(applyCalls.length).toBeGreaterThan(0);
    expect(Object.keys(applyCalls[0]?.args ?? {})).toEqual([
      "root",
      "changes",
      "deletes",
    ]);
    expect(applyCalls[0]?.args.root).toBe("E:/proj/Resources");
  });

  it("零差量 → 仍走 stamp 比对（无冲突）但 apply 空跑，报告为空", async () => {
    const backend = makeMemoryBackend();
    backend.put("project.json", "{清单}");
    const files = new Map([["project.json", "{清单}"]]);
    const writer = await makeWriter(backend, files);
    const report = await writer.apply(files);
    expect(report).toEqual({ written: [], deleted: [] });
    expect(backend.opLog).toEqual([]);
  });

  it("失败注入：apply_project_files reject → apply 抛、基线不更新 → 重试幂等", async () => {
    const backend = makeMemoryBackend();
    let failNext = true;
    const failing: TauriInvoke = async <T>(
      command: string,
      args?: Record<string, unknown>,
    ) => {
      if (failNext && command === "apply_project_files") {
        throw new Error("IO 注入失败");
      }
      return backend.invoke(command, args) as Promise<T>;
    };
    const writer = await createTauriProjectWriter(
      "E:/proj/Resources",
      new Map(),
      { invoke: failing },
    );
    const files = new Map([["Stories/a.json", "{列a}"]]);
    await expect(writer.apply(files)).rejects.toThrow("IO 注入失败");
    failNext = false;
    const report = await writer.apply(files); // 基线未更新 → 重试仍带全量差量
    expect(report.written).toEqual(["Stories/a.json"]);
    expect(backend.disk.get("Stories/a.json")?.text).toBe("{列a}");
  });

  it("负载形状 fail-closed：stamps 坏 → 构造抛；报告坏 → apply 抛（不静默采信）", async () => {
    // T03-02 后拦截点前移：stamps 形状非法在工厂构造期即拦（零副作用）
    const badStamps: TauriInvoke = async <T>() => ({ foo: 1 } as T);
    await expect(
      createTauriProjectWriter("E:/proj/Resources", new Map(), {
        invoke: badStamps,
      }),
    ).rejects.toThrow("指纹负载形状非法");
    // T03-01 契约保留：stamps 合法但写回报告 written/deleted 非字符串数组 → apply 抛
    const badReport: TauriInvoke = async <T>(command: string) =>
      command === "stamp_project_files" ? ({ stamps: [] } as T) : ({ foo: 1 } as T);
    const writer = await createTauriProjectWriter(
      "E:/proj/Resources",
      new Map(),
      { invoke: badReport },
    );
    await expect(
      writer.apply(new Map([["Stories/a.json", "x"]])),
    ).rejects.toThrow("写回报告形状非法");
  });

  it("T03-02 外部篡改：apply 前检测 → 冲突文案、零落盘（未篡改时行为不变）", async () => {
    const backend = makeMemoryBackend();
    backend.put("Stories/start.json", WRITE_START);
    const writer = await makeWriter(
      backend,
      new Map([["Stories/start.json", WRITE_START]]),
    );
    // 外部程序改磁盘（mtime 前进 + 内容变化）
    backend.externalWrite("Stories/start.json", '{"外部改的"}');
    await expect(
      writer.apply(new Map([["Stories/start.json", WRITE_START]])),
    ).rejects.toThrow("磁盘已被外部修改");
    // 零写入：磁盘仍是外部版本（writer 未覆盖）
    expect(backend.disk.get("Stories/start.json")?.text).toBe('{"外部改的"}');
    // 未篡改（恢复一致）后行为不变：重开 writer 保存成功
    const writer2 = await makeWriter(
      backend,
      new Map([["Stories/start.json", '{"外部改的"}']]),
    );
    const report = await writer2.apply(
      new Map([["Stories/start.json", WRITE_START]]),
    );
    expect(report.written).toEqual(["Stories/start.json"]);
  });

  it("T03-02 外部删除基线文件 → 冲突持续 fail-closed；重开后可重建且不自报", async () => {
    const backend = makeMemoryBackend();
    backend.put("Stories/start.json", WRITE_START);
    const writer = await makeWriter(
      backend,
      new Map([["Stories/start.json", WRITE_START]]),
    );
    backend.externalDelete("Stories/start.json");
    await expect(
      writer.apply(new Map([["Stories/start.json", WRITE_START]])),
    ).rejects.toThrow("磁盘已被外部修改");
    // 零落盘：磁盘保持外部删除后的状态（writer 不擅自重建）
    expect(backend.disk.has("Stories/start.json")).toBe(false);
    // 磁盘状态未变 → 持续冲突（快照未换新，fail-closed 无自我恢复）
    await expect(
      writer.apply(new Map([["Stories/start.json", WRITE_START]])),
    ).rejects.toThrow("磁盘已被外部修改");
    // 按文案重新打开工程（基线 = 磁盘现状，被删文件不在基线）→ 保存可重建
    const reopened = await makeWriter(backend, new Map());
    const report = await reopened.apply(
      new Map([["Stories/start.json", WRITE_START]]),
    );
    expect(report).toEqual({ written: ["Stories/start.json"], deleted: [] });
    // 自己的写入不自报：快照已换新 → 二次保存零差量空跑、不误报
    const report2 = await reopened.apply(
      new Map([["Stories/start.json", WRITE_START]]),
    );
    expect(report2).toEqual({ written: [], deleted: [] });
  });
});

const WRITE_START =
  '{"formatVersion":1,"id":"start","kind":"flow","commands":[]}';
