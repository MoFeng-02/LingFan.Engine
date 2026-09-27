/**
 * 元素资源解析缓存（P2：三处宿主共用实现）：
 * 同步查表语义（未就绪返回 undefined）/ 同路径在途去重 / 落地回调宿主重渲染 /
 * 失败不粘滞（资源补上后仍可再试，且不触发重渲染）。
 */
import { describe, expect, it, vi } from "vitest";
import { createElementResourceResolver } from "@lingfan/ui";

/** 手动控制的解析（观察「在途」窗口） */
function deferred(): {
  promise: Promise<string>;
  resolve: (url: string) => void;
  reject: (error: unknown) => void;
} {
  let resolve: (url: string) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("元素资源解析缓存（createElementResourceResolver）", () => {
  it("未命中 → undefined 并只发起一次解析；落地后回调并转为同步命中", async () => {
    const pending = deferred();
    const resolveFn = vi.fn(() => pending.promise);
    const onResolved = vi.fn();
    const resolver = createElementResourceResolver({
      resolve: resolveFn,
      onResolved,
    });

    expect(resolver.resolveForElement("Images/bg.png")).toBeUndefined();
    expect(resolver.resolveForElement("Images/bg.png")).toBeUndefined(); // 在途去重
    expect(resolveFn).toHaveBeenCalledTimes(1);
    expect(onResolved).not.toHaveBeenCalled();

    pending.resolve("blob:bg");
    await vi.waitFor(() => {
      expect(onResolved).toHaveBeenCalledTimes(1);
    });
    expect(resolver.resolveForElement("Images/bg.png")).toBe("blob:bg");
    expect(resolveFn).toHaveBeenCalledTimes(1); // 命中不再问端口
  });

  it("解析失败 → 保持 undefined 且不触发重渲染；资源补上后可重试成功", async () => {
    const onResolved = vi.fn();
    let attempt = 0;
    const resolver = createElementResourceResolver({
      resolve: async (path: string) => {
        attempt += 1;
        if (attempt === 1) throw new Error(`资源不存在：${path}`);
        return "blob:later";
      },
      onResolved,
    });

    expect(resolver.resolveForElement("Images/later.png")).toBeUndefined();
    await vi.waitFor(() => {
      expect(attempt).toBe(1);
    });
    expect(onResolved).not.toHaveBeenCalled(); // 失败不伪造 URL，也不重渲染

    expect(resolver.resolveForElement("Images/later.png")).toBeUndefined();
    await vi.waitFor(() => {
      expect(resolver.resolveForElement("Images/later.png")).toBe("blob:later");
    });
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it("不同路径各自解析、各自落缓存", async () => {
    const seen: string[] = [];
    const resolver = createElementResourceResolver({
      resolve: async (path: string) => {
        seen.push(path);
        return `blob:${path}`;
      },
      onResolved: () => {},
    });
    resolver.resolveForElement("Images/a.png");
    resolver.resolveForElement("Images/b.png");
    await vi.waitFor(() => {
      expect(resolver.resolveForElement("Images/b.png")).toBe("blob:Images/b.png");
    });
    expect(seen).toEqual(["Images/a.png", "Images/b.png"]);
    expect(resolver.resolveForElement("Images/a.png")).toBe("blob:Images/a.png");
  });
});