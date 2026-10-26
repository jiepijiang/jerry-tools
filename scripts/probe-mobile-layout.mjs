/* =========================================================================
   probe-mobile-layout.mjs —— 窄屏「整页横向滚动」守卫

   为什么值得一个常驻探针（2026-10-26）：

     首页在 375×812 + touch 下 `documentElement.scrollWidth` 是 **388**
     （视口 375）—— 整页能左右拖 13px。根因是 `.bm-tooltip`：
     它靠 `.bm-card:hover` 才可见，而 `clampTooltip()` 挂在 `mouseenter` 上，
     移动端永远不触发 → 提示框以 `opacity: 0` 留在布局里、位置没被夹回视口。

     这类问题**没有任何报错路径**：桌面端看起来完全正常（hover 时会 clamp），
     只有真的用手机宽度量才会发现。而且改任何一条 tooltip / 卡片 CSS 都可能
     重新引入 —— 所以钉住。

   判据只有一条，但必须量**文档**而不是某个元素：
     `documentElement.scrollWidth - clientWidth === 0`
     元素级「越界」在横向滚动容器（`.sb-list`）里是**正常**的，不能当判据。

   用法：
     npm run serve:dist      # 另一个终端，5200
     node probe-mobile-layout.mjs [base]
   ========================================================================= */

import pw from './lib/playwright.mjs'

const { chromium } = pw
const BASE = process.argv[2] || 'http://127.0.0.1:5200/jerry-tools/'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const url = (p) => new URL(String(p).replace(/^\//, ''), BASE).href

/** 只量「窄屏 + 触摸」，也就是手机。桌面端不在这里管。 */
const VIEWPORT = { width: 375, height: 812 }

const ROUTES = [
  ['首页', ''],
  ['发现页', 'discover'],
]

let pass = 0
let fail = 0
const failures = []

function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    failures.push(`${name}${detail ? `\n     ${detail}` : ''}`)
    console.log(`  ❌ ${name}${detail ? `  → ${detail}` : ''}`)
  }
}

const browser = await chromium.launch({ headless: true })
try {
  for (const [name, p] of ROUTES) {
    const ctx = await browser.newContext({ viewport: VIEWPORT, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    await page.goto(url(p), { waitUntil: 'domcontentloaded' })
    // 等首屏渲染完（卡片 / 分类条都在）
    await page.waitForFunction(
      () => !!document.querySelector('.bm-card, .site-card'),
      null,
      { timeout: 30000 },
    ).catch(() => {})
    await sleep(2500)

    const r = await page.evaluate(() => {
      const de = document.documentElement
      return {
        vw: de.clientWidth,
        scrollW: de.scrollWidth,
        // 只列**不在横向滚动容器里**的越界元素 —— 那才是真溢出
        culprits: [...document.querySelectorAll('body *')]
          .filter((el) => {
            const b = el.getBoundingClientRect()
            if (b.width === 0 || b.height === 0) return false
            if (b.right <= de.clientWidth + 1) return false
            return !el.closest('.sb-list')
          })
          .slice(0, 3)
          .map((el) => {
            const b = el.getBoundingClientRect()
            const cls = (typeof el.className === 'string' ? el.className : '').split(' ')[0]
            return `${el.tagName.toLowerCase()}.${cls} right=${Math.round(b.right)}`
          }),
      }
    })

    check(
      `【${name}】@${VIEWPORT.width}px 文档无横向滚动`,
      r.scrollW === r.vw,
      `scrollWidth ${r.scrollW} > clientWidth ${r.vw}` +
        (r.culprits.length ? `；越界：${r.culprits.join(' / ')}` : ''),
    )

    await ctx.close()
  }
} finally {
  await browser.close()
}

console.log(`\n通过 ${pass} / 失败 ${fail}`)
if (fail) {
  console.log('\n❌ 有问题：')
  for (const f of failures) console.log(`   · ${f}`)
  process.exit(1)
}
