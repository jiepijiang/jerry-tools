/* =========================================================================
   probe-discover-lazy.mjs —— 「发现页种子数据不在主包里」守卫

   为什么值得一个常驻探针（2026-10-14）：

     377 条发现页数据打包后 90.5KB，而它**只有发现页用得上**。
     原先它是 `useStore.js` 的**顶层 import** → 被 Rollup **内联进主包**
     → **每一个访客**（哪怕只打开首页看自己的书签）都要下载它。
     现在改成 `readSites()` 里的动态 import → 单独成 chunk、不进 preload。

   ⚠️ **这条退化没有任何报错路径**：把动态 import 改回顶层 import，
      站点一切正常（发现页照样有数据），只是主包悄悄胖了 90KB。

   ── 判据是怎么定下来的（造红时改过一次，值得记）────────────────────

   第一版写的是「回访首页时不该出现 `seed-discover-*.js` 这个请求」。
   造红（把 import 改回顶层）时它**没红** —— 因为顶层 import 会让
   Rollup 把那份数据**内联进主包**，于是「独立请求」在两个状态下都为空，
   这条断言**恒真、没有判别力**。

   所以核心判据改成**内容判据**：主包里到底有没有发现页数据。
   它不依赖「有没有独立请求」这种会随打包策略变化的现象。

   ── 判据 ──────────────────────────────────────────────────────────

     ① 主包里**不含**发现页数据（内容判据，核心）← 改回顶层 import 时必红
     ② 冷启动时发现页数据是**独立请求**（不是随主包一起来的）
     ③ 回访首页时**不请求**它（按需加载的业务事实）
     ④ 发现页照常渲染出站点卡片（改动没把功能弄坏）

   ⚠️ ③ 单独看**抓不到**「改回顶层 import」（那种退化由 ① 抓）。
      保留它是因为它测的是另一件事：「已有本地数据时不再加载」。

   ⚠️ ② 的观察窗口：要断言一个请求没发生，只能给它一段时间看它来不来。
      窗口 2.5s —— 本地同源加载 90KB 远快于此，所以「窗口结束还没来」可信。
      （与「别用 sleep 赌时序」不冲突：那条说的是别用 sleep 等**一定会发生**的事。）

   用法：node scripts/probe-discover-lazy.mjs [base]
        默认 http://127.0.0.1:5200/jerry-tools/（先 npm run build && npm run serve:dist）
   ========================================================================= */

import pw from './lib/playwright.mjs'

const { chromium } = pw
const BASE = process.argv[2] || 'http://127.0.0.1:5200/jerry-tools/'

/**
 * 发现页数据的特征串。
 * 用 Grep 核对过：`OpenClaw` **只**出现在 `src/data/seed-discover.js`（1 处），
 * 书签种子 `seed.js` 里没有 —— 否则主包本来就会命中，判据就废了。
 */
const DISCOVER_MARKER = 'OpenClaw'

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}   ${detail}`)
  }
}

const isSeedDiscover = (u) => /seed-discover[.-][^/]*\.js$/.test(u)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

let reqs = []
page.on('request', (r) => reqs.push(r.url()))

console.log(`\n基线：${BASE}\n`)

/* ------------------------------------------------------------------ */
/* 冷启动：localStorage 空 → 要灌种子                                  */
/* ------------------------------------------------------------------ */

reqs = []
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bm-card', { timeout: 25000 })
await page.waitForTimeout(800)

const sitesWritten = await page.evaluate(() => {
  try {
    return JSON.parse(localStorage.getItem('jt:sites') || '[]').length
  } catch {
    return -1
  }
})
check(`冷启动灌入发现页数据（${sitesWritten} 条）`, sitesWritten > 0, `读到 ${sitesWritten}`)

check(
  '冷启动时它是**独立请求**（不是随主包一起来）',
  reqs.some(isSeedDiscover),
  '请求列表里找不到 seed-discover chunk —— 多半被内联进主包了',
)

/* ------------------------------------------------------------------ */
/* ① 核心：主包里不含发现页数据                                        */
/* ------------------------------------------------------------------ */

const mainJsUrl = await page.evaluate(() => {
  const s = [...document.querySelectorAll('script[type=module][src]')].find((x) =>
    /assets\/index-[^/]*\.js$/.test(x.src),
  )
  return s ? s.src : null
})

if (!mainJsUrl) {
  check('找得到主包入口', false, 'index.html 里没有 assets/index-*.js')
} else {
  const mainBody = await page.evaluate(async (u) => (await fetch(u)).text(), mainJsUrl)
  check(
    `主包不含发现页数据（${(mainBody.length / 1024).toFixed(0)}KB）`,
    !mainBody.includes(DISCOVER_MARKER),
    `主包里出现了 ${DISCOVER_MARKER} —— 发现页数据被内联进主包了（改回顶层 import 就会这样）`,
  )
}

/* ------------------------------------------------------------------ */
/* ③ 回访：已有 jt:sites → 不该再加载                                  */
/* ------------------------------------------------------------------ */

reqs = []
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bm-card', { timeout: 25000 })
await page.waitForTimeout(2500)

const hotReqs = reqs.filter(isSeedDiscover)
check(
  '回访首页不再加载发现页数据',
  hotReqs.length === 0,
  `实际请求了 ${hotReqs.length} 次：${hotReqs.join(', ')}`,
)

/* ------------------------------------------------------------------ */
/* ④ 发现页照常渲染                                                    */
/* ------------------------------------------------------------------ */

await page.goto(BASE + 'discover', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.site-card', { timeout: 25000 })
const cardCount = await page.evaluate(() => document.querySelectorAll('.site-card').length)
check(`发现页渲染出站点卡片（${cardCount} 张）`, cardCount > 0, `读到 ${cardCount}`)

await browser.close()

console.log(`\n通过 ${pass} / 失败 ${fail}`)
process.exit(fail ? 1 : 0)
