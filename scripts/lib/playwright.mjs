/**
 * playwright 的统一解析 —— 让探针**换台机器也能跑**。
 *
 * 为什么需要它：
 *   探针原来写的是 `import pw from '/Users/jiepijiang/node_modules/playwright-core/index.js'`。
 *   绝对路径只在**原机**成立 —— 换台机器、换个人 clone 下来，直接 `ERR_MODULE_NOT_FOUND`。
 *   这和 `check-i18n-*.mjs` 里那个「别写死绝对路径」是同一个坑。
 *
 * 解析顺序（找到第一个存在的就用）：
 *   1. `$PLAYWRIGHT_PATH`            —— 显式指定，优先级最高
 *   2. `<仓库>/node_modules/…`       —— 项目自己装了 playwright / playwright-core
 *   3. `~/node_modules/…`            —— 本机全局装的那种（Jerry 这台就是这种）
 *
 * ⚠️ **不要**把 playwright 加进 `devDependencies`。
 *    这几个探针要真浏览器 + 真 Supabase，**进不了 CI**；
 *    加进依赖只会让每次 `npm ci` 都拖一遍浏览器包（几百 MB），白花钱。
 *
 * 用法：
 *   import pw from './lib/playwright.mjs'
 *   const browser = await pw.chromium.launch({ headless: true })
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 仓库根 —— 由本文件位置推出（`scripts/lib/` → 上两级）。 */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const CANDIDATES = [
  process.env.PLAYWRIGHT_PATH,
  join(ROOT, 'node_modules/playwright-core/index.js'),
  join(ROOT, 'node_modules/playwright/index.js'),
  join(homedir(), 'node_modules/playwright-core/index.js'),
  join(homedir(), 'node_modules/playwright/index.js'),
].filter(Boolean)

let loaded = null
let from = null
for (const c of CANDIDATES) {
  if (!existsSync(c)) continue
  const m = await import(pathToFileURL(c).href)
  loaded = m.default ?? m
  from = c
  break
}

if (!loaded) {
  throw new Error(
    [
      '找不到 playwright。探针需要它才能起浏览器。',
      '',
      '试过这些位置：',
      ...CANDIDATES.map((c) => '  ' + c),
      '',
      '装一个就行（不进 package.json）：',
      '  npm i --no-save playwright-core     # 在仓库根跑',
      '或者指定现成的：',
      '  PLAYWRIGHT_PATH=/path/to/playwright-core/index.js node scripts/<探针>.mjs',
    ].join('\n'),
  )
}

/** 实际用的是哪一份 —— 排查「为什么起不来」时有用。 */
export const PLAYWRIGHT_FROM = from

export default loaded
