import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { build } from "vite";
import { resolveImport } from "./graph.mjs";

const VIRTUAL_ENTRY = "\0audit-runtime-virtual-entry";

/**
 * 命名空间聚合：把包的**公开面整体**挂到全局对象上再打包。
 *
 * 为什么不用 `import "@lingfan-engine/core"` 这种副作用式导入：包声明了 `sideEffects: false`，
 * 副作用式导入会被摇树清空，量出来是 0 KB 的假数。逐名导入又只量到宿主恰好用到的那几个词，
 * 低估分包压力。挂命名空间对象强制保留公开面全部导出——量到的是**上界**，这正是
 * 「主包到底装不装得下」需要的保守口径。
 */
function aggregateSource(specs) {
  const lines = specs.map(
    (spec, index) => `import * as ns${index} from ${JSON.stringify(spec)};`,
  );
  lines.push(
    `globalThis.__auditBundle = [${specs.map((_, index) => `ns${index}`).join(", ")}];`,
  );
  return lines.join("\n");
}

function virtualEntryPlugin(repoRoot, source) {
  return {
    name: "audit-runtime-virtual-entry",
    resolveId(id) {
      if (id === VIRTUAL_ENTRY) return VIRTUAL_ENTRY;
      if (!id.startsWith("@lingfan-engine/")) return null;
      return (
        resolveImport(id, join(repoRoot, "package.json"), repoRoot).file ?? null
      );
    },
    load(id) {
      return id === VIRTUAL_ENTRY ? source : null;
    },
  };
}

async function bundleOnce({ repoRoot, source }) {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    root: repoRoot,
    plugins: [virtualEntryPlugin(repoRoot, source)],
    build: {
      write: false,
      minify: "esbuild",
      target: "es2020",
      reportCompressedSize: false,
      rollupOptions: {
        input: VIRTUAL_ENTRY,
        output: {
          format: "es",
          entryFileNames: "bundle.js",
          codeSplitting: false,
        },
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = outputs
    .flatMap((out) => out.output ?? [])
    .find((item) => item.type === "chunk");
  if (chunk === undefined) throw new Error("打包未产出 chunk");
  const bytes = Buffer.byteLength(chunk.code);
  if (bytes === 0) throw new Error("打包产物为空——入口被摇树清空");
  return { bytes, gzipBytes: gzipSync(chunk.code).length };
}

/**
 * 单包与合并产物体积（minified / gzip）。
 *
 * 度量口径 = 打包器产出的**压缩后单文件**（`minify: esbuild`，与宿主构建同一条压缩链），
 * 不是源文件字节数——源文件里有类型与注释，拿它估主包会严重高估。
 * gzip 是传输口径；小程序主包按解压后字节计，所以判定超限看 `bytes`。
 * 合并行是**去重**结果：引擎被编辑器与 UI 共用，分别打包会算两遍，据此分包会做错决定。
 */
export async function measureSizes({ repoRoot, entrySpecs }) {
  const rows = [];
  for (const spec of entrySpecs) {
    const measured = await bundleOnce({
      repoRoot,
      source: aggregateSource([spec]),
    });
    rows.push({ label: spec, ...measured, note: "公开面全量（上界）" });
  }
  const combined = await bundleOnce({
    repoRoot,
    source: aggregateSource(entrySpecs),
  });
  rows.push({
    label: `合并（${entrySpecs.length} 包）`,
    ...combined,
    note: "共享代码已去重",
  });
  return rows;
}
