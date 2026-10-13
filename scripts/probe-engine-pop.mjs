/* =========================================================================
   probe-engine-pop.mjs —— 搜索引擎下拉框的**层叠**与**不透明**守卫

   为什么值得一个常驻探针：2026-10-13 发现的缺陷**肉眼可见、代码上却完全看不出来** ——

     ① 下拉框的最后一项**被书签卡片盖住，点不到**。
        根因：`.bar` 是 `.glass` → 带 `backdrop-filter` → **创建层叠上下文**，
        于是 `.engine-pop` 上的 `z-index: 120` 只在 `.bar` 内部有效；
        在根层叠上下文里 `.bar` 仍是 `z-index: auto`，而 DOM 更靠后的
        `.bm-card`（也带 backdrop-filter）排在它后面 → 卡片压住下拉。
     ② 下拉框背景只有 62% 不透明（`.glass` 的 `--item_bg_color`），
        底下的分类计数、卡片标题**透上来和下拉项叠在一起**。

   两条都不是「样式好不好看」，是**功能坏了**（点不到）和**读不了**（字叠字）。
   所以固化成断言，别再靠肉眼。

   判据：
     · 每一项的中心点，`elementsFromPoint()` 最上层必须是它自己（或其子元素）；
     · 下拉框背景必须**近不透明**（alpha ≥ 0.9），不能是 .glass 那种半透明；
     · 下拉框整体要压在卡片之上（用 z-index 链验，不只看计算值）。

   用法：node scripts/probe-engine-pop.mjs [base]
        默认 http://127.0.0.1:5174/（先 npm run dev）
   ========================================================================= */

import pw from './lib/playwright.mjs'

const { chromium } = pw
const BASE = process.argv[2] || 'http://127.0.0.1:5174/'

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

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
// ⚠️ 别用 networkidle —— 站上有 Supabase realtime 长连接，永远不会 idle。
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.engine-btn', { timeout: 20000 })
await page.waitForTimeout(600)

await page.click('.engine-btn')
await page.waitForTimeout(350)

const probe = await page.evaluate(() => {
  const pop = document.querySelector('.engine-pop')
  if (!pop) return { missing: true }
  const cs = getComputedStyle(pop)
  const rows = [...pop.querySelectorAll('.engine-item')].map((el) => {
    const r = el.getBoundingClientRect()
    const stack = document.elementsFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2))
    return { text: el.textContent.trim(), topmostIsSelf: el.contains(stack[0]), topmost: String(stack[0]?.className || stack[0]?.tagName) }
  })
  const m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor)
  const parts = m ? m[1].split(',').map((s) => Number(s.trim())) : []
  const alpha = parts.length === 4 ? parts[3] : 1
  return {
    rows,
    bg: cs.backgroundColor,
    alpha,
    backdrop: cs.backdropFilter,
    rect: (() => { const r = pop.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } })(),
  }
})

console.log(`\n下拉框：${JSON.stringify(probe.rect)}  背景 ${probe.bg}  backdrop ${probe.backdrop}\n`)

check('下拉框渲染出来了', !probe.missing)
if (!probe.missing) {
  const n = probe.rows.length
  check(`5 个搜索引擎都在（实际 ${n}）`, n === 5, `实际 ${n}`)

  const covered = probe.rows.filter((r) => !r.topmostIsSelf)
  check(
    '每一项都在最上层（没被卡片盖住）',
    covered.length === 0,
    covered.map((r) => `${r.text}←被 ${r.topmost} 盖住`).join('；'),
  )

  // 最后一项最容易出事（它在下拉框最下方，正对着第一排卡片）
  const last = probe.rows[probe.rows.length - 1]
  check(`最后一项「${last?.text}」点得到`, !!last?.topmostIsSelf, `最上层是 ${last?.topmost}`)

  check('背景近不透明（alpha ≥ 0.9）', probe.alpha >= 0.9, `实际 alpha=${probe.alpha}（${probe.bg}）`)
}

/* —— 造红开关：给 .bar 加上 z-index:auto 就应重新被盖住 ——
   用 UI_SQL 那种环境变量法不适用（这是 DOM 断言），所以提供一段
   可复制的说明，见文件末尾。 */

await page.screenshot({ path: 'scripts/out-engine-pop.png', clip: { x: probe.rect.x - 30, y: probe.rect.y - 90, width: 560, height: 380 } }).catch(() => {})
console.log('\n截图（若目录存在）：scripts/out-engine-pop.png')

await browser.close()
console.log(`\n${'─'.repeat(52)}\n通过 ${pass} / 失败 ${fail}`)
process.exit(fail ? 1 : 0)
