/**
 * 编辑器工程模型：**目录取径**供给测试（FSA 句柄 / 目录 input 文件快照）。
 *
 * 平台 API 按契约以内存替身注入（不 Mock 引擎实现）：目录句柄只实现用到的
 * `values/getFileHandle/getDirectoryHandle` 三面；文件 = Node 内置 `File`。
 * 覆盖：资源根定位（直选 / 下探 / 歧义 / 缺失）、枚举口径（Stories 递归、跳点文件）、
 * `.enc` fail-closed、`ProjectFilesPort` → 引擎组装整链、`ResourcePort` 的
 * Blob URL 缓存与 release、路径逃逸拒绝。
 */
import { describe, expect, it } from "vitest";
import {
  createFileListFileSource,
  createHandleFileSource,
  createHandleProjectWriter,
  createSourceProjectFilesPort,
  createSourceResourcePort,
  loadProject,
  locateResourceRootFromPaths,
} from "@lingfan/adapters";

type Tree = { [name: string]: Tree | string };

function fileHandle(name: string, text: string): FileSystemFileHandle {
  return {
    kind: "file",
    name,
    async getFile(): Promise<File> {
      return new File([text], name);
    },
  } as unknown as FileSystemFileHandle;
}

function dirHandle(name: string, tree: Tree): FileSystemDirectoryHandle {
  return {
    kind: "directory",
    name,
    async *values(): AsyncGenerator<FileSystemDirectoryHandle | FileSystemFileHandle> {
      for (const [entryName, value] of Object.entries(tree)) {
        yield typeof value === "string"
          ? fileHandle(entryName, value)
          : dirHandle(entryName, value);
      }
    },
    async getFileHandle(entryName: string): Promise<FileSystemFileHandle> {
      const value = tree[entryName];
      if (typeof value !== "string") {
        throw new DOMException("not found", "NotFoundError");
      }
      return fileHandle(entryName, value);
    },
    async getDirectoryHandle(entryName: string): Promise<FileSystemDirectoryHandle> {
      const value = tree[entryName];
      if (value === undefined || typeof value === "string") {
        throw new DOMException("not found", "NotFoundError");
      }
      return dirHandle(entryName, value);
    },
  } as unknown as FileSystemDirectoryHandle;
}

const MANIFEST = JSON.stringify({ formatVersion: 1, id: "demo", entry: "start" });
const START = JSON.stringify({
  formatVersion: 1,
  id: "start",
  kind: "flow",
  commands: [{ op: "say", text: "甲" }],
});

/** 一个最小合法资源根（清单 + 单列故事） */
function resourceRoot(): Tree {
  return {
    "project.json": MANIFEST,
    Stories: { "start.json": START },
    Audio: { "bgm.mp3": "audio-bytes" },
    Images: { "bg.png": "png-bytes" },
  };
}

function fileAt(relativePath: string, text: string): File {
  const file = new File([text], relativePath.split("/").pop() ?? relativePath);
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  return file;
}

/** 注入 Blob URL 工厂（Node 无 `URL.createObjectURL`）：只统计调用，返回可读的假 URL */
function blobUrls(): {
  create: (file: File) => string;
  revoke: (url: string) => void;
  created: string[];
  revoked: string[];
} {
  const created: string[] = [];
  const revoked: string[] = [];
  let seq = 0;
  return {
    created,
    revoked,
    create: (file: File) => {
      const url = `blob:${file.name}#${++seq}`;
      created.push(url);
      return url;
    },
    revoke: (url: string) => {
      revoked.push(url);
    },
  };
}

describe("目录取径·FSA 句柄", () => {
  it("直选资源根：枚举相对逻辑路径 + 引擎组装整链（清单/故事原始文本）", async () => {
    const source = await createHandleFileSource(dirHandle("Resources", resourceRoot()));
    expect(source.name).toBe("Resources");
    expect(await source.paths()).toEqual([
      "Audio/bgm.mp3",
      "Images/bg.png",
      "Stories/start.json",
      "project.json",
    ]);
    const story = await loadProject(createSourceProjectFilesPort(source));
    expect(story.id).toBe("demo");
    expect(story.columns.map((c) => c.id)).toEqual(["start"]);
  });

  it("误选工程根：下探一层 Resources/ 仍可打开（资源根定位对用户友好）", async () => {
    const source = await createHandleFileSource(
      dirHandle("playground", { Resources: resourceRoot(), "README.md": "x" }),
    );
    expect(source.name).toBe("Resources");
    // 只枚举资源根之内：宿主目录里的无关文件不进供给
    expect(await source.paths()).not.toContain("README.md");
  });

  it("没有清单 → fail-closed 且说清怎么修（不猜、不静默空工程）", async () => {
    await expect(
      createHandleFileSource(dirHandle("Desktop", { Stories: { "a.json": "{}" } })),
    ).rejects.toThrow("未找到 project.json");
  });

  it("点文件 / 点目录不进供给（资源根里的 `.*` 不是工程内容）", async () => {
    const source = await createHandleFileSource(
      dirHandle("Resources", {
        ...resourceRoot(),
        ".DS_Store": "junk",
        ".git": { config: "junk" },
      }),
    );
    const paths = await source.paths();
    expect(paths.some((path) => path.includes(".git"))).toBe(false);
    expect(paths).not.toContain(".DS_Store");
  });

  it("加密故事（.enc）→ fail-closed（解密归 Rust，浏览器形态不装作能读）", async () => {
    const source = await createHandleFileSource(
      dirHandle("Resources", {
        "project.json": MANIFEST,
        Stories: { "start.json.enc": "cipher" },
      }),
    );
    // 形态判定归 encryptedProject 唯一判定点（前置、统一可操作文案）——
    // 这里只锁「打开必被拒 + 文案说明形态与出路」，具体措辞由该模块的测试守护。
    await expect(loadProject(createSourceProjectFilesPort(source))).rejects.toThrow(
      /加密工程（lfenpack 产物）[\s\S]*明文工程/,
    );
  });

  it("缺 Stories/ → fail-closed", async () => {
    const source = await createHandleFileSource(
      dirHandle("Resources", { "project.json": MANIFEST }),
    );
    await expect(loadProject(createSourceProjectFilesPort(source))).rejects.toThrow(
      "缺少 Stories/",
    );
  });
});

describe("目录取径·资源端口（Blob URL）", () => {
  it("resolve → 文件 → Blob URL；同路径复用同一 URL 且只建一次", async () => {
    const source = await createHandleFileSource(dirHandle("Resources", resourceRoot()));
    const urls = blobUrls();
    const port = createSourceResourcePort(source, {
      createObjectURL: urls.create,
      revokeObjectURL: urls.revoke,
    });
    const first = await port.resolve("Images/bg.png");
    const again = await port.resolve("Images/bg.png");
    expect(first).toBe(again);
    expect(urls.created).toHaveLength(1);
    // 前导斜杠归一（与静态根适配器同口径）
    expect(await port.resolve("/Images/bg.png")).toBe(first);
  });

  it("并发 resolve 同路径只解析一次（在途去重）", async () => {
    const source = await createHandleFileSource(dirHandle("Resources", resourceRoot()));
    const urls = blobUrls();
    const port = createSourceResourcePort(source, {
      createObjectURL: urls.create,
      revokeObjectURL: urls.revoke,
    });
    const all = await Promise.all([
      port.resolve("Audio/bgm.mp3"),
      port.resolve("Audio/bgm.mp3"),
      port.resolve("Audio/bgm.mp3"),
    ]);
    expect(new Set(all).size).toBe(1);
    expect(urls.created).toHaveLength(1);
  });

  it("release 只 revoke 本端口产出的 URL，之后可重新解析", async () => {
    const source = await createHandleFileSource(dirHandle("Resources", resourceRoot()));
    const urls = blobUrls();
    const port = createSourceResourcePort(source, {
      createObjectURL: urls.create,
      revokeObjectURL: urls.revoke,
    });
    const url = await port.resolve("Audio/bgm.mp3");
    port.release("blob:外来 URL");
    expect(urls.revoked).toEqual([]); // 外来 URL 不误导 revoke
    port.release(url);
    expect(urls.revoked).toEqual([url]);
    expect(await port.resolve("Audio/bgm.mp3")).not.toBe(url); // 释放后重建
  });

  it("资源不存在 / 路径逃逸 → 抛错（调用方 fail-closed 不显示）", async () => {
    const source = await createHandleFileSource(dirHandle("Resources", resourceRoot()));
    const urls = blobUrls();
    const port = createSourceResourcePort(source, {
      createObjectURL: urls.create,
      revokeObjectURL: urls.revoke,
    });
    await expect(port.resolve("Images/ghost.png")).rejects.toThrow("资源不存在");
    await expect(port.resolve("../outside.png")).rejects.toThrow("资源路径非法");
  });

  it("解析失败不粘滞：资源补齐后重试成功", async () => {
    const tree = resourceRoot();
    const source = await createHandleFileSource(dirHandle("Resources", tree));
    const urls = blobUrls();
    const port = createSourceResourcePort(source, {
      createObjectURL: urls.create,
      revokeObjectURL: urls.revoke,
    });
    await expect(port.resolve("Images/later.png")).rejects.toThrow("资源不存在");
    (tree.Images as Tree)["later.png"] = "arrived";
    await expect(port.resolve("Images/later.png")).resolves.toContain("later.png");
  });
});

describe("目录取径·目录 input 文件快照", () => {
  it("资源根 = 清单所在层，路径剥前缀（选工程根也能打开）", async () => {
    const files = [
      fileAt("playground/Resources/project.json", MANIFEST),
      fileAt("playground/Resources/Stories/start.json", START),
      fileAt("playground/Resources/Audio/bgm.mp3", "audio-bytes"),
      fileAt("playground/README.md", "x"),
    ];
    const source = await createFileListFileSource(files);
    expect(source.name).toBe("Resources");
    expect(await source.paths()).toEqual([
      "Audio/bgm.mp3",
      "Stories/start.json",
      "project.json",
    ]);
    const story = await loadProject(createSourceProjectFilesPort(source));
    expect(story.columns.map((c) => c.id)).toEqual(["start"]);
    await expect(source.file("Audio/bgm.mp3")).resolves.toBeInstanceOf(File);
  });

  it("同深多个清单 → 不替用户猜，报可操作的错", async () => {
    await expect(
      createFileListFileSource([
        fileAt("a/project.json", MANIFEST),
        fileAt("b/project.json", MANIFEST),
      ]),
    ).rejects.toThrow("发现多个 project.json");
  });

  it("无清单 → fail-closed", async () => {
    await expect(
      createFileListFileSource([fileAt("x/Stories/a.json", START)]),
    ).rejects.toThrow("未找到 project.json");
  });

  it("locateResourceRootFromPaths：取最浅清单，前缀含目录分隔符", () => {
    expect(
      locateResourceRootFromPaths(["a/b/project.json", "project.json", "Stories/x.json"]),
    ).toEqual({ root: "", manifest: "project.json" });
    expect(locateResourceRootFromPaths(["Resources/project.json"])).toEqual({
      root: "Resources/",
      manifest: "project.json",
    });
  });
});

// —— 写回：FSA 目录句柄（可变树替身 + 权限/失败注入） ——

/** 替身文件 mtime 种子：固定初值保证未动过的文件指纹稳定（不随 Date.now 漂移） */
const SEED_MTIME = 1_700_000_000_000;
type MutableFileNode = {
  kind: "file";
  name: string;
  text: string;
  mtime: number;
};
type MutableDirNode = {
  kind: "dir";
  name: string;
  children: Map<string, MutableNode>;
};
type MutableNode = MutableFileNode | MutableDirNode;

interface WriteHooks {
  /** 缺省 = 该 API 不存在（老 Chromium：不预检，直接尝试写） */
  permission?: {
    query?: PermissionState;
    request?: PermissionState | "throw";
  };
  /** 命中逻辑路径的 createWritable 直接抛错 */
  failWrite?: Map<string, Error>;
  failRemove?: Map<string, Error>;
  /** 落盘动作序（`write:<path>` / `remove:<path>` / `abort:<path>`） */
  log: string[];
  /** 权限 API 调用序（query / request）——验「申请在写之前」 */
  permissionCalls: string[];
  /** 写/外部改动共用的 mtime 计数：每次落盘或篡改后指纹严格前进 */
  tick?: number;
  /** 外部程序改动（绕过 writer）：改内容 + 前进 mtime（模拟他人保存） */
  externalEdit?: (path: string, text: string) => void;
  /** 外部程序删除基线文件（绕过 writer） */
  externalRemove?: (path: string) => void;
}

function mutableNodes(
  tree: Tree,
  index: Map<string, MutableNode>,
  prefix = "",
): Map<string, MutableNode> {
  const out = new Map<string, MutableNode>();
  const childPath = (name: string): string =>
    prefix === "" ? name : `${prefix}/${name}`;
  for (const [name, value] of Object.entries(tree)) {
    if (typeof value === "string") {
      const node: MutableFileNode = {
        kind: "file",
        name,
        text: value,
        mtime: SEED_MTIME,
      };
      index.set(childPath(name), node);
      out.set(name, node);
    } else {
      const node: MutableDirNode = {
        kind: "dir",
        name,
        children: mutableNodes(value, index, childPath(name)),
      };
      index.set(childPath(name), node);
      out.set(name, node);
    }
  }
  return out;
}

function mutableFileHandle(
  node: MutableFileNode,
  path: string,
  hooks: WriteHooks,
): FileSystemFileHandle {
  return {
    kind: "file",
    name: node.name,
    async getFile(): Promise<File> {
      return new File([node.text], node.name, { lastModified: node.mtime });
    },
    async createWritable(): Promise<unknown> {
      const failure = hooks.failWrite?.get(path);
      if (failure !== undefined) throw failure;
      let pending = node.text;
      return {
        async write(data: string): Promise<void> {
          pending = String(data);
        },
        async close(): Promise<void> {
          node.text = pending;
          hooks.tick = (hooks.tick ?? 0) + 1;
          node.mtime = SEED_MTIME + hooks.tick;
          hooks.log.push(`write:${path}`);
        },
        async abort(): Promise<void> {
          hooks.log.push(`abort:${path}`);
        },
      };
    },
  } as unknown as FileSystemFileHandle;
}

function mutableDirHandle(
  node: MutableDirNode,
  path: string,
  hooks: WriteHooks,
): FileSystemDirectoryHandle {
  const childPath = (name: string): string =>
    path === "" ? name : `${path}/${name}`;
  const handle: Record<string, unknown> = {
    kind: "directory",
    name: node.name,
    async *values(): AsyncGenerator<
      FileSystemDirectoryHandle | FileSystemFileHandle
    > {
      for (const child of node.children.values()) {
        yield child.kind === "file"
          ? mutableFileHandle(child, childPath(child.name), hooks)
          : mutableDirHandle(child, childPath(child.name), hooks);
      }
    },
    async getFileHandle(
      name: string,
      options?: { create?: boolean },
    ): Promise<FileSystemFileHandle> {
      const existing = node.children.get(name);
      if (existing === undefined) {
        if (options?.create !== true) {
          throw new DOMException("not found", "NotFoundError");
        }
        const created: MutableFileNode = {
          kind: "file",
          name,
          text: "",
          mtime: SEED_MTIME,
        };
        node.children.set(name, created);
        return mutableFileHandle(created, childPath(name), hooks);
      }
      if (existing.kind !== "file") {
        throw new DOMException("not a file", "TypeMismatchError");
      }
      return mutableFileHandle(existing, childPath(name), hooks);
    },
    async getDirectoryHandle(
      name: string,
      options?: { create?: boolean },
    ): Promise<FileSystemDirectoryHandle> {
      const existing = node.children.get(name);
      if (existing === undefined) {
        if (options?.create !== true) {
          throw new DOMException("not found", "NotFoundError");
        }
        const created: MutableDirNode = {
          kind: "dir",
          name,
          children: new Map(),
        };
        node.children.set(name, created);
        return mutableDirHandle(created, childPath(name), hooks);
      }
      if (existing.kind !== "dir") {
        throw new DOMException("not a dir", "TypeMismatchError");
      }
      return mutableDirHandle(existing, childPath(name), hooks);
    },
    async removeEntry(name: string): Promise<void> {
      const failure = hooks.failRemove?.get(childPath(name));
      if (failure !== undefined) throw failure;
      if (!node.children.has(name)) {
        throw new DOMException("not found", "NotFoundError");
      }
      node.children.delete(name);
      hooks.log.push(`remove:${childPath(name)}`);
    },
  };
  // 权限 API 按 hook 决定「存在与否」（模型：API 缺失的老 Chromium 路径）
  if (hooks.permission?.query !== undefined) {
    handle.queryPermission = async (): Promise<PermissionState> => {
      hooks.permissionCalls.push("query");
      return hooks.permission?.query ?? "prompt";
    };
  }
  if (hooks.permission?.request !== undefined) {
    handle.requestPermission = async (): Promise<PermissionState> => {
      hooks.permissionCalls.push("request");
      const decision = hooks.permission?.request;
      if (decision === "throw") {
        throw new DOMException("denied", "NotAllowedError");
      }
      return decision ?? "denied";
    };
  }
  return handle as unknown as FileSystemDirectoryHandle;
}

function writableRoot(
  tree: Tree,
  hooks: WriteHooks,
): FileSystemDirectoryHandle {
  const index = new Map<string, MutableNode>();
  const rootNode: MutableDirNode = {
    kind: "dir",
    name: "Resources",
    children: mutableNodes(tree, index),
  };
  const bump = (): number => {
    hooks.tick = (hooks.tick ?? 0) + 1;
    return SEED_MTIME + hooks.tick;
  };
  hooks.externalEdit = (path, text) => {
    const node = index.get(path);
    if (node === undefined || node.kind !== "file") {
      throw new Error(`externalEdit 未知文件：${path}`);
    }
    node.text = text;
    node.mtime = bump();
  };
  hooks.externalRemove = (path) => {
    const segments = path.split("/");
    const name = segments[segments.length - 1] ?? "";
    const parentPath = segments.slice(0, -1).join("/");
    const parent = parentPath === "" ? rootNode : index.get(parentPath);
    if (parent === undefined || parent.kind !== "dir") {
      throw new Error(`externalRemove 父目录缺失：${path}`);
    }
    if (!parent.children.delete(name)) {
      throw new Error(`externalRemove 未知文件：${path}`);
    }
    index.delete(path);
  };
  return mutableDirHandle(rootNode, "", hooks);
}

async function readText(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<string | undefined> {
  const segments = path.split("/");
  let dir = root;
  for (const segment of segments.slice(0, -1)) {
    try {
      dir = await dir.getDirectoryHandle(segment);
    } catch {
      return undefined;
    }
  }
  try {
    const file = await dir.getFileHandle(segments[segments.length - 1] ?? "");
    return await (await file.getFile()).text();
  } catch {
    return undefined;
  }
}

const WRITE_MANIFEST = '{"formatVersion":1,"id":"demo","entry":"start"}';
const WRITE_START = '{"formatVersion":1,"id":"start","kind":"flow","commands":[]}';

function grantedHooks(): WriteHooks {
  return { log: [], permissionCalls: [], permission: { query: "granted" } };
}

describe("写回·FSA 目录句柄", () => {
  it("写回顺序：先写列文件、project.json 最后、再删陈旧（永不先删后写）", async () => {
    const hooks = grantedHooks();
    const root = writableRoot(
      {
        "project.json": WRITE_MANIFEST,
        Stories: { "start.json": WRITE_START, "old.json": WRITE_START },
        Audio: { "bgm.mp3": "audio" },
      },
      hooks,
    );
    const previous = new Map<string, string>([
      ["project.json", WRITE_MANIFEST],
      ["Stories/start.json", WRITE_START],
      ["Stories/old.json", WRITE_START],
    ]);
    const writer = await createHandleProjectWriter(root, previous);
    expect(writer.writable).toBe(true);
    const wanted = new Map<string, string>([
      ["Stories/new.json", '{"formatVersion":1,"id":"new","kind":"flow","commands":[]}'],
      [
        "Stories/start.json",
        '{"formatVersion":1,"id":"start","kind":"flow","commands":[{"op":"say","text":"改"}]}',
      ],
      [
        "project.json",
        '{\n  "formatVersion": 1,\n  "id": "demo",\n  "entry": "start",\n  "defines": {\n    "a": 1\n  }\n}\n',
      ],
    ]);
    const report = await writer.apply(wanted);
    expect(report.written).toEqual([
      "Stories/new.json",
      "Stories/start.json",
      "project.json",
    ]);
    expect(report.deleted).toEqual(["Stories/old.json"]);

    const lastWrite = hooks.log.lastIndexOf("write:project.json");
    expect(lastWrite).toBeGreaterThan(-1);
    hooks.log.forEach((entry, index) => {
      if (entry.startsWith("remove:")) expect(index).toBeGreaterThan(lastWrite);
    });
    expect(await readText(root, "Stories/new.json")).toContain('"new"');
    expect(await readText(root, "Stories/old.json")).toBeUndefined();
    expect(await readText(root, "Audio/bgm.mp3")).toBe("audio"); // 非 Stories 永不动

    // 幂等：同期望集再保存 → 零写零删（基线已更新）
    expect(await writer.apply(wanted)).toEqual({ written: [], deleted: [] });
  });

  it("首次保存：Stories/ 不存在也能建目录后写入", async () => {
    const hooks = grantedHooks();
    const root = writableRoot({ "project.json": WRITE_MANIFEST }, hooks);
    const writer = await createHandleProjectWriter(root, new Map());
    const report = await writer.apply(
      new Map([
        ["Stories/a.json", '{"formatVersion":1,"id":"a","kind":"flow","commands":[]}'],
      ]),
    );
    expect(report.written).toEqual(["Stories/a.json"]);
    expect(await readText(root, "Stories/a.json")).toContain('"a"');
  });

  it("写失败：零删除、旧文件仍在；修复后重试即收敛（幂等）", async () => {
    const hooks = grantedHooks();
    const root = writableRoot(
      { "project.json": WRITE_MANIFEST, Stories: { "old.json": WRITE_START } },
      hooks,
    );
    const writer = await createHandleProjectWriter(
      root,
      new Map([["Stories/old.json", WRITE_START]]),
    );
    const wanted = new Map<string, string>([
      ["Stories/a.json", '{"formatVersion":1,"id":"a","kind":"flow","commands":[]}'],
    ]);
    hooks.failWrite = new Map([["Stories/a.json", new Error("磁盘写满")]]);
    await expect(writer.apply(wanted)).rejects.toThrow("磁盘写满");
    expect(hooks.log.filter((e) => e.startsWith("remove:"))).toEqual([]);
    expect(await readText(root, "Stories/old.json")).toBe(WRITE_START);

    hooks.failWrite = undefined;
    const report = await writer.apply(wanted);
    expect(report.written).toEqual(["Stories/a.json"]);
    expect(report.deleted).toEqual(["Stories/old.json"]);
  });

  it("删除失败：新内容与清单已落盘，报错并列出陈旧路径（可手工清理）", async () => {
    const hooks = grantedHooks();
    const root = writableRoot(
      { "project.json": WRITE_MANIFEST, Stories: { "old.json": WRITE_START } },
      hooks,
    );
    const writer = await createHandleProjectWriter(
      root,
      new Map([["Stories/old.json", WRITE_START]]),
    );
    hooks.failRemove = new Map([["Stories/old.json", new Error("文件被占用")]]);
    await expect(
      writer.apply(
        new Map([
          ["Stories/a.json", '{"formatVersion":1,"id":"a","kind":"flow","commands":[]}'],
        ]),
      ),
    ).rejects.toThrow("文件被占用");
    expect(await readText(root, "Stories/a.json")).toContain('"a"');
  });

  it("外部篡改：apply 前检测 → 冲突文案、零落盘（未篡改时行为不变）", async () => {
    const hooks = grantedHooks();
    const root = writableRoot(
      {
        "project.json": WRITE_MANIFEST,
        Stories: { "start.json": WRITE_START },
      },
      hooks,
    );
    const writer = await createHandleProjectWriter(
      root,
      new Map([
        ["project.json", WRITE_MANIFEST],
        ["Stories/start.json", WRITE_START],
      ]),
    );
    // 外部程序改磁盘（内容 + mtime 前进）；wanted 为全量期望集（diff 零差量也检测）
    hooks.externalEdit!("Stories/start.json", '{"外部改的"}');
    const wanted = new Map<string, string>([
      ["Stories/start.json", WRITE_START],
      ["project.json", WRITE_MANIFEST],
    ]);
    await expect(writer.apply(wanted)).rejects.toThrow("磁盘已被外部修改");
    // 零落盘：磁盘仍是外部版本（writer 未覆盖）
    expect(await readText(root, "Stories/start.json")).toBe('{"外部改的"}');
    // 未篡改时行为不变：重开 writer（基线 = 磁盘现状）→ 保存成功
    const writer2 = await createHandleProjectWriter(
      root,
      new Map([["Stories/start.json", '{"外部改的"}']]),
    );
    const report = await writer2.apply(
      new Map([["Stories/start.json", WRITE_START]]),
    );
    expect(report.written).toEqual(["Stories/start.json"]);
  });

  it("外部删除基线文件 → 冲突持续 fail-closed；重开后可重建且不自报", async () => {
    const hooks = grantedHooks();
    const root = writableRoot(
      {
        "project.json": WRITE_MANIFEST,
        Stories: { "start.json": WRITE_START },
      },
      hooks,
    );
    const writer = await createHandleProjectWriter(
      root,
      new Map([
        ["project.json", WRITE_MANIFEST],
        ["Stories/start.json", WRITE_START],
      ]),
    );
    hooks.externalRemove!("Stories/start.json");
    const wanted = new Map<string, string>([
      ["Stories/start.json", WRITE_START],
      ["project.json", WRITE_MANIFEST],
    ]);
    await expect(writer.apply(wanted)).rejects.toThrow("磁盘已被外部修改");
    // 零落盘：磁盘保持外部删除后的状态（writer 不擅自重建）
    expect(await readText(root, "Stories/start.json")).toBeUndefined();
    // 磁盘状态未变 → 持续冲突（快照未换新，fail-closed 无自我恢复）
    await expect(writer.apply(wanted)).rejects.toThrow("磁盘已被外部修改");
    // 按文案重新打开工程（基线 = 磁盘现状，被删文件不在基线）→ 保存可重建
    const reopened = await createHandleProjectWriter(
      root,
      new Map([["project.json", WRITE_MANIFEST]]),
    );
    const report = await reopened.apply(wanted);
    expect(report.written).toEqual(["Stories/start.json"]);
    // 自己的写入不自报：快照已换新 → 二次保存零差量空跑
    const report2 = await reopened.apply(wanted);
    expect(report2).toEqual({ written: [], deleted: [] });
  });

  it("权限：granted 不询问；prompt→granted 先申请后写；denied / NotAllowedError 归一且零写入", async () => {
    const one = new Map([
      ["Stories/a.json", '{"formatVersion":1,"id":"a","kind":"flow","commands":[]}'],
    ]);

    // granted：不调用 requestPermission
    {
      const hooks = grantedHooks();
      const writer = await createHandleProjectWriter(
        writableRoot({ "project.json": WRITE_MANIFEST }, hooks),
        new Map(),
      );
      await writer.apply(one);
      expect(hooks.permissionCalls).toEqual(["query"]);
      expect(hooks.log).toContain("write:Stories/a.json");
    }

    // prompt → granted：申请发生在写之前
    {
      const hooks: WriteHooks = {
        log: [],
        permissionCalls: [],
        permission: { query: "prompt", request: "granted" },
      };
      const writer = await createHandleProjectWriter(
        writableRoot({ "project.json": WRITE_MANIFEST }, hooks),
        new Map(),
      );
      await writer.apply(one);
      expect(hooks.permissionCalls).toEqual(["query", "request"]);
      expect(hooks.log).toEqual(["write:Stories/a.json"]);
    }

    // denied：零写入
    {
      const hooks: WriteHooks = {
        log: [],
        permissionCalls: [],
        permission: { query: "prompt", request: "denied" },
      };
      const writer = await createHandleProjectWriter(
        writableRoot({ "project.json": WRITE_MANIFEST }, hooks),
        new Map(),
      );
      await expect(writer.apply(one)).rejects.toThrow("未获得写入权限");
      expect(hooks.log).toEqual([]);
    }

    // requestPermission 抛 NotAllowedError：同一文案
    {
      const hooks: WriteHooks = {
        log: [],
        permissionCalls: [],
        permission: { query: "prompt", request: "throw" },
      };
      const writer = await createHandleProjectWriter(
        writableRoot({ "project.json": WRITE_MANIFEST }, hooks),
        new Map(),
      );
      await expect(writer.apply(one)).rejects.toThrow("未获得写入权限");
      expect(hooks.log).toEqual([]);
    }

    // 无 permission API（老 Chromium）+ createWritable 抛 NotAllowedError：归一
    {
      const hooks: WriteHooks = { log: [], permissionCalls: [] };
      hooks.failWrite = new Map([
        ["Stories/a.json", new DOMException("denied", "NotAllowedError")],
      ]);
      const writer = await createHandleProjectWriter(
        writableRoot({ "project.json": WRITE_MANIFEST }, hooks),
        new Map(),
      );
      await expect(writer.apply(one)).rejects.toThrow("未获得写入权限");
    }
  });

  it("路径穿越防御：../ 与穿越段一律拒绝且零写入", async () => {
    const hooks = grantedHooks();
    const writer = await createHandleProjectWriter(
      writableRoot({ "project.json": WRITE_MANIFEST }, hooks),
      new Map(),
    );
    await expect(
      writer.apply(new Map([["../evil.json", "x"]])),
    ).rejects.toThrow("非法");
    await expect(
      writer.apply(new Map([["Stories/../../evil.json", "x"]])),
    ).rejects.toThrow("非法");
    expect(hooks.log).toEqual([]);
  });
});