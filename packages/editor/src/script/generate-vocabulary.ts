/**
 * 词汇层声明重建 CLI（Node 侧，tsx 运行，不经打包）：
 *
 *   pnpm --filter @lingfan/playground exec tsx ../../packages/editor/src/script/generate-vocabulary.ts
 *
 * words 域源码扫描 + op 注册表键集（OP_SCHEMAS，与 OP_SCHEMA_MAP 同一对象）→
 * 差量写 vocabulary.g.ts：内容不变 = 零差量零写入。
 * 渲染是纯函数（vocabulary-gen），本文件只做 IO 与守卫。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { OP_SCHEMAS } from "../schema/index.ts";
import { renderVocabulary, selectWordSources } from "./vocabulary-gen.ts";

function rebuild(): void {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const wordsDir = path.join(dir, "words");
  const target = path.join(dir, "vocabulary.g.ts");
  const sources = selectWordSources(readdirSync(wordsDir)).map((file) => ({
    file,
    text: readFileSync(path.join(wordsDir, file), "utf8"),
  }));
  const content = renderVocabulary(Object.keys(OP_SCHEMAS), sources);
  const stale = !existsSync(target) || readFileSync(target, "utf8") !== content;
  if (!stale) {
    console.log("已是最新（零差量）：src/script/vocabulary.g.ts");
    return;
  }
  writeFileSync(target, content, "utf8");
  console.log("已更新：src/script/vocabulary.g.ts");
}

const invoked = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (invoked) {
  try {
    rebuild();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
