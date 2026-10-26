/* =========================================================================
   alias-loader.mjs —— 让裸 `node` 也能解析 `@/` 别名

   为什么需要：`probe-icon-mode.mjs` 能直接用 `node` 跑，是因为它 import 的
   `helpers.js` / `options.js` **零 import**，依赖链是干净的。
   但 `transfer.js` 里有 `import { storageKeys } from '@/data/options'` ——
   Node 不认识 `@/`，直接 `node probe-transfer.mjs` 会
   `ERR_MODULE_NOT_FOUND`。

   三条路：
     1. 把 `transfer.js` 的 import 改成相对路径 —— **不选**。为了测试改产品代码，
        而且项目里到处是 `@/`，改一处反而成了例外。
     2. 装 vite-node / vitest —— **不选**。为几十行纯函数加一个测试框架，
        和「零依赖探针」的既有做法相悖（见 scripts/README.md）。
     3. 注册一个 20 行的 resolve hook —— **选这个**。只在探针进程里生效，
        产品代码一个字不动。

   用法（探针文件里）：

     import { register } from 'node:module'
     register('./lib/alias-loader.mjs', import.meta.url)
     const mod = await import('../src/data/transfer.js')   // 必须是动态 import

   ⚠️ 必须是**动态** import：静态 import 会在 `register()` 执行前就被解析掉，
      那时候 hook 还没装。
   ========================================================================= */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 项目根下的 `src/`。本文件在 `scripts/lib/`，所以往上两级。 */
const SRC_DIR = fileURLToPath(new URL('../../src/', import.meta.url))

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const base = path.join(SRC_DIR, specifier.slice(2))
    for (const cand of [base, `${base}.js`, path.join(base, 'index.js')]) {
      if (existsSync(cand)) {
        return { url: pathToFileURL(cand).href, shortCircuit: true }
      }
    }
  }
  return nextResolve(specifier, context)
}
