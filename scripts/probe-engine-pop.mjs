/* =========================================================================
   probe-engine-pop.mjs —— 搜索引擎下拉框的**层叠 / 不透明 / 收起时机**守卫

   为什么值得一个常驻探针：2026-10-13 发现的缺陷**肉眼可见、代码上却完全看不出来** ——

     ① 下拉框的最后一项**被书签卡片盖住，点不到**。
        根因：`.bar` 是 `.glass` → 带 `backdrop-filter` → **创建层叠上下文**，
        于是 `.engine-pop` 上的 `z-index: 120` 只在 `.bar` 内部有效；
        在根层叠上下文里 `.bar` 仍是 `z-index: auto`，而 DOM 更靠后的
        `.bm-card`（也带 backdrop-filter）排在它后面 → 卡片压住下拉。
     ② 下拉框背景只有 62% 不透明（`.glass` 的 `--item_bg_color`），
        底下的分类计数、卡片标题**透上来和下拉项叠在一起**。
     ③ 下拉框**点别处不收起**（同日 Jerry 反馈）。改之前只有 `pickEngine()`
        会置 `engineOpen = false` —— 只有选中某一项才关得掉。

   三条都不是「样式好不好看」，是**功能坏了**（点不到 / 关不掉）和
   **读不了**（字叠字）。所以固化成断言，别再靠肉眼。

   判据：
     · 每一项的中心点，`elementsFromPoint()` 最上层必须是它自己（或其子元素）；
     · 下拉框背景必须**近不透明**（alpha ≥ 0.9），不能是 .glass 那种半透明；
     · 下拉框整体要压在卡片之上（用 z-index 链验，不只看计算值）；
     · **凡点在 `.engine` 之外的 `pointerdown`，都要收起**（含输入框、
       页面别处、Esc）；而点按钮、点下拉项该有的行为不能被改坏。

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

/* —— 截图先拍：下面的交互断言会把下拉关掉 ——
   造红开关不适用（这是 DOM 断言），说明见文件末尾。 */
await page.screenshot({ path: 'scripts/out-engine-pop.png', clip: { x: probe.rect.x - 30, y: probe.rect.y - 90, width: 560, height: 380 } }).catch(() => {})
console.log('\n截图（若目录存在）：scripts/out-engine-pop.png')

/* =========================================================================
   交互：**什么时候该收起**（2026-10-13 补）

   Jerry 反馈：「出现这个下拉框的时候点击其他部分应该要收起」。

   改之前只有 `pickEngine()` 会把 engineOpen 置 false —— 也就是**只有选中
   某一项才关得掉**。所以这里的判据是「**点在 .engine 之外的 pointerdown
   都要收起**」，而不是「点按钮会切换」（后者本来就有）。
   ========================================================================= */

const isOpen = async () => !!(await page.$('.engine-pop'))

/** 打开下拉（已开则不动）。 */
async function openPop() {
  if (!(await isOpen())) {
    await page.click('.engine-btn')
    await page.waitForSelector('.engine-pop', { timeout: 3000 })
  }
  await page.waitForTimeout(260)
}

/** 断言「已收起」——等它**真的从 DOM 摘掉**，而不是 sleep 一个数。
 *
 *  ⚠️ 这里踩过一次（2026-10-13，第一版就是错的）：我写的是
 *     `await waitForTimeout(280); check(..., !(await isOpen()))`
 *     —— 结果 ①③⑤ 三条**假红**，看着像「点别处不收起」，其实收起了。
 *
 *     真实时序（用 MutationObserver 量的）：pointerdown 到达后
 *     **~342ms** 元素才离开 DOM，而不是 `.pop-leave-active` 声明的 160ms。
 *     原因是 `src/styles/base.css` 有一条全局 `* { transition: background-color
 *     0.2s ease }`，Vue 的 <Transition> 把它也算进了 leave 时长。
 *     （视觉上 160ms 就淡没了，DOM 多留一会儿而已 —— 不影响体验，但
 *      写死 sleep 一定会翻车。）
 *
 *     📌 一般化：**「多久之后应该好了」不要写死秒数，等状态本身。**
 *     这正是 CONVENTIONS 里「别用 sleep 赌时序」那条。
 */
async function expectClosed(label) {
  try {
    await page.waitForSelector('.engine-pop', { state: 'detached', timeout: 1500 })
    check(label, true)
  } catch {
    check(label, false, '1.5s 内仍留在 DOM')
  }
}

/** 找一个「点了不会出事」的页面空白点：不能是链接 / 按钮 / 卡片 / 分类行。
 *  ⚠️ 必须**先验证再点** —— 随手点一个坐标可能点中书签卡片，
 *  那会 window.open 弹出新标签页，把后面的断言全带偏。 */
const safeSpot = await page.evaluate(() => {
  for (const [x, y] of [[1268, 420], [12, 420], [1268, 150], [640, 690]]) {
    const el = document.elementFromPoint(x, y)
    if (!el) continue
    if (el.closest('a, button, .bm-card, .cat-row, .engine-pop, input')) continue
    return { x, y, tag: el.tagName, cls: String(el.className || '') }
  }
  return null
})

console.log('\n交互断言（判据：点在 .engine 之外的 pointerdown 都要收起）\n')

// ① 搜索栏里、下拉之外的其它部分（输入框）
await openPop()
await page.click('.msb-input')
await expectClosed('点搜索栏里的其它部分（输入框）→ 收起')

// ② 页面别处（真空白点）
if (safeSpot) {
  await openPop()
  await page.mouse.click(safeSpot.x, safeSpot.y)
  await expectClosed(`点页面别处（${safeSpot.x},${safeSpot.y} → ${safeSpot.tag}）→ 收起`)
} else {
  check('点页面别处 → 收起', false, '没找到安全的空白点，断言没跑（不能算绿）')
}

// ③ 再点按钮 → 收起（toggle 的另一半，别被①把行为改坏）
await openPop()
await page.click('.engine-btn')
await expectClosed('再点一次按钮 → 收起')

// ④ Esc
await openPop()
await page.keyboard.press('Escape')
await expectClosed('按 Esc → 收起')

// ⑤ 点下拉项本身 → 收起，并且**真的换成了**
//    （这条同时反证：外部点击的捕获监听**没有**把下拉项自己的 click 抢掉）
await openPop()
const before = (await page.textContent('.engine-btn')).trim()
await page.click('.engine-item:last-child')
await expectClosed('点下拉项 → 收起')
const after = (await page.textContent('.engine-btn')).trim()
check('点下拉项 → 选中项真的变了（不是只收起）', before !== after, `点前「${before}」点后「${after}」`)

await browser.close()
console.log(`\n${'─'.repeat(52)}\n通过 ${pass} / 失败 ${fail}`)
process.exit(fail ? 1 : 0)
