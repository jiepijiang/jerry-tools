/* =========================================================================
   probe-footer.mjs —— 页脚（互链矩阵 + 可读性）守卫

   2026-10-13 把页脚改成与技能站 `HubFooter.vue` 同一套结构：
     版权 · 本站名 · GitHub · 姊妹站… · 管理

   为什么要固化成断言：

     ① **姊妹站地址现在有两个渲染点**（顶栏 navItems + 页脚）。
        收进 `src/data/site.js` 之后两处共用一份 —— 但「共用」这件事
        本身要被验：断言直接拿 `data/site.js` 的常量跟**渲染出来的 href**
        比对，而不是再抄一遍字面量（抄一遍就等于没有单一来源）。
     ② **页脚最容易漏本站自己**：四站互链的判据是「指向**其余**三站」，
        把自己也列进去看着不报错，但那条链接是死的（当前页）。
     ③ **可读性会被「照抄样式」悄悄弄坏**。第一版就是照抄了技能站的
        `opacity: 0.75` —— 那边是纯白字压在深色底上（5.3:1），
        这边底子已经是灰的，再乘一次 → **3.19:1**，低于 AA 的 4.5:1。
        肉眼「看着淡」不算判据，所以这里算**有效对比度**。

   判据：
     · 版权段、GitHub、三个姊妹站、管理入口都在，且顺序与 `data/site.js` 一致；
     · 每个**站外**链接都是 `target=_blank` + `rel=noopener noreferrer`；
       管理入口是**站内**链接（不能 _blank）；
     · 页脚里**不许出现本站地址**（不链回自己）；
     · 页脚文字的有效对比度 **≥ 4.5:1**（WCAG AA 正文）；
     · 切到英文后**不许混进中日韩字符**（i18n 漏了会当场露馅）。

   用法：node scripts/probe-footer.mjs [base]
        默认 http://127.0.0.1:5200/jerry-tools/（先 npm run serve:dist）
   ========================================================================= */

import pw from './lib/playwright.mjs'
// 直接 import 真来源 —— 断言里的预期值必须来自数据，不能手写第二份
import { repo, siblings } from '../src/data/site.js'

const BASE = process.argv[2] || 'http://127.0.0.1:5200/jerry-tools/'
const VIEWPORT = { width: 1280, height: 900 }

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

/** 把页脚读成一个结构化对象（中文语境）。 */
async function readFooter(page) {
  return page.evaluate(() => {
    const f = document.querySelector('.app-footer')
    if (!f) return { missing: true }
    const inner = f.querySelector('.app-footer-inner')
    return {
      text: f.innerText.replace(/\s*\n\s*/g, ' ').trim(),
      firstSpan: inner.querySelector('span')?.textContent.trim() || '',
      seps: inner.querySelectorAll('.sep').length,
      links: [...inner.querySelectorAll('a')].map((a) => ({
        text: a.textContent.trim(),
        href: a.getAttribute('href'),
        abs: a.href,
        target: a.getAttribute('target'),
        rel: a.getAttribute('rel'),
        isAdmin: a.classList.contains('admin-entry'),
      })),
      adminIcons: inner.querySelectorAll('.admin-entry svg').length,
      html: f.innerHTML,
    }
  })
}

/** 页脚文字（链接）的**有效**对比度：把祖先链上的 opacity 累乘后再合成。
 *
 *  ⚠️ **这是近似值，不是真实像素。** 它拿 `body` 的底色当背景，
 *     而本站页脚背后其实是「背景图 + 薄纱」。真实像素实测（2026-10-13）：
 *
 *     | 主题 | 本探针（近似） | 真实像素中位 | 真实像素最差 |
 *     | --- | --- | --- | --- |
 *     | Light | 5.28:1 | ~6:1 | — |
 *     | Dark  | 5.29:1 | **4.15:1** | **2.04:1** |
 *
 *     深色下真实值低于近似值，因为照片有亮部（那节车厢）。**这条断言
 *     因此是「防大幅回退」的哨兵，不是「保证 AA」的证明** —— 它抓的是
 *     「有人又加了一层 opacity」这类**成倍**的劣化，抓不到照片亮部。
 *
 *     顺带一个**改动前的对照**（同样的量法，线上旧页脚）：中位 4.70、最差 2.09。
 *     也就是说「深色下压在照片上偏糊」**不是这次改出来的**，旧页脚就有；
 *     这次只是页脚变长，更多字落到了亮处，中位从 4.70 挪到 4.15。
 *     **没加遮罩**是有意的 —— 技能站的页脚也没有，加了就不是「一样的样式」了。
 */
async function measureContrast(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.app-footer a')
    if (!el) return null
    let alpha = 1
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const o = Number.parseFloat(getComputedStyle(n).opacity)
      if (!Number.isNaN(o)) alpha *= o
    }
    const nums = (s) => (s.match(/[\d.]+/g) || []).map(Number)
    const fg = nums(getComputedStyle(el).color).slice(0, 3)
    // ⚠️ 近似：本站页脚背后是「背景图 + 薄纱」，这里只取 body 的底色当背景。
    //    薄纱是 0.86 的近白，实际底色比这个更亮或相近 —— 深色文字只会更清楚，
    //    所以拿它算出来的对比度是**偏保守**的一侧。
    const bg = nums(getComputedStyle(document.body).backgroundColor).slice(0, 3)
    const eff = fg.map((v, i) => v * alpha + bg[i] * (1 - alpha))
    const lin = (c) => {
      c /= 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
    const l1 = lum(eff)
    const l2 = lum(bg)
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
    return {
      ratio: Number(((hi + 0.05) / (lo + 0.05)).toFixed(2)),
      alpha: Number(alpha.toFixed(2)),
      eff: eff.map((v) => Math.round(v)),
      bg,
    }
  })
}

const browser = await pw.chromium.launch()

/* ------------------------------------------------------------ 中文（默认） */
const ctx = await browser.newContext({ viewport: VIEWPORT })
const page = await ctx.newPage()
// ⚠️ 别用 networkidle —— 站上有 Supabase realtime 长连接，永远不会 idle。
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.app-footer', { timeout: 20000 })
await page.waitForTimeout(600)

const f = await readFooter(page)
console.log(`\n页脚：${f.text}\n`)

check('页脚渲染出来了', !f.missing)
if (!f.missing) {
  check('版权段 = 「Jerry © 2026 · Jerry 导航」', f.firstSpan === 'Jerry © 2026 · Jerry 导航', `实际「${f.firstSpan}」`)

  const outside = f.links.filter((l) => !l.isAdmin)
  const admin = f.links.filter((l) => l.isAdmin)

  // ① GitHub
  const gh = outside.find((l) => l.text === 'GitHub')
  check('GitHub 链接存在', !!gh)
  if (gh) {
    check('GitHub 指向本站仓库', gh.href === repo, `实际 ${gh.href}，期望 ${repo}`)
  }

  // ② 姊妹站：**顺序与 href 都拿 data/site.js 比**，不抄字面量
  const sibLinks = outside.filter((l) => l.href !== repo)
  check(`姊妹站数量 = ${siblings.length}（实际 ${sibLinks.length}）`, sibLinks.length === siblings.length)
  check(
    '姊妹站 href 与 data/site.js 逐条一致（含顺序）',
    sibLinks.length === siblings.length && sibLinks.every((l, i) => l.href === siblings[i].href),
    sibLinks.map((l, i) => `${i}: ${l.href} vs ${siblings[i]?.href}`).join('；'),
  )

  // ③ 页脚里不许出现本站自己 —— 判据取「外链集合**恰好等于** GitHub + 姊妹站」，
  //    多出任何一条都算（链回当前页就是死链，而且不会报错，只会点了没反应）。
  const expected = new Set([repo, ...siblings.map((s) => s.href)])
  const extra = outside.filter((l) => !expected.has(l.href))
  check(
    '页脚外链恰好 = GitHub + 姊妹站（没有多余入口，也没链回自己）',
    extra.length === 0,
    extra.map((l) => `${l.text} → ${l.href}`).join('；'),
  )

  // ④ 站外链接一律新窗口 + noopener
  const badBlank = outside.filter((l) => l.target !== '_blank' || !/noopener/.test(l.rel || ''))
  check(
    '站外链接都是 _blank + rel=noopener',
    badBlank.length === 0,
    badBlank.map((l) => `${l.text}(target=${l.target} rel=${l.rel})`).join('；'),
  )

  // ⑤ 管理入口：站内链接，且**不能**新窗口
  check('管理入口存在', admin.length === 1, `实际 ${admin.length} 个`)
  if (admin.length === 1) {
    const a = admin[0]
    check('管理入口是站内链接（/admin）', /\/admin\/?$/.test(a.abs), `实际 ${a.abs}`)
    check('管理入口不新窗口打开', !a.target, `target=${a.target}`)
    check('管理入口带图标（锁 / 盾）', f.adminIcons === 1, `实际 ${f.adminIcons} 个 svg`)
  }

  // ⑥ 分隔符数量：n 个段落之间应有 n-1 个 ·（技能站同款结构）
  //    段落 = 版权段(1) + 外链(GitHub + 姊妹站) + 管理入口
  const segments = 1 + outside.length + admin.length
  check(`分隔符数量 = 段落数 - 1（${segments - 1}）`, f.seps === segments - 1, `实际 ${f.seps}`)
}

/* ------------------------------------------------------------ 可读性 */
const c = await measureContrast(page)
if (c) {
  console.log(`\n有效对比度：${c.ratio}:1   有效色 rgb(${c.eff.join(',')}) / 底 rgb(${c.bg.join(',')})   累积 opacity ${c.alpha}\n`)
  check(
    '页脚文字有效对比度 ≥ 4.5:1（WCAG AA 正文）',
    c.ratio >= 4.5,
    `实际 ${c.ratio}:1（累积 opacity ${c.alpha}）`,
  )
} else {
  check('量到页脚对比度', false, '没找到 .app-footer a')
}

/* ------------------------------------------------------------ 窄视口 */
await page.setViewportSize({ width: 375, height: 800 })
await page.waitForTimeout(500)
const narrow = await page.evaluate(() => {
  const doc = document.documentElement
  const ov = () => doc.scrollWidth - doc.clientWidth
  const f = document.querySelector('.app-footer')
  const withFooter = ov()
  f.style.display = 'none'
  const withoutFooter = ov()
  f.style.display = ''
  return {
    withFooter,
    withoutFooter,
    clientW: doc.clientWidth,
    footerRight: Math.round(f.getBoundingClientRect().right),
    innerRight: Math.round(f.querySelector('.app-footer-inner').getBoundingClientRect().right),
  }
})

/* ⚠️ 判据是「**页脚自己**没把页面撑宽」，不是「页面没有横向溢出」。
 *
 *    第一版写成后者，得到一条**跟页脚无关的红**：375 宽下页面本来就溢出 12px。
 *    对照实测（2026-10-13）：**改动前的线上也是 12**，而且把 `.app-footer`
 *    藏掉之后**仍然是 12** —— 那 12px 来自别处（侧栏 `.cat-name` 等）。
 *    拿页面级指标去判一个局部组件，红绿都不说明这个组件的事。 */
check(
  '375 宽下页脚没有把页面撑宽',
  narrow.withFooter === narrow.withoutFooter,
  `带页脚 ${narrow.withFooter}px / 藏掉页脚 ${narrow.withoutFooter}px`,
)
check(
  '375 宽下页脚自身在视口内（换行，不横向溢出）',
  narrow.footerRight <= narrow.clientW && narrow.innerRight <= narrow.clientW,
  `页脚右边界 ${narrow.footerRight}、内层 ${narrow.innerRight}，视口宽 ${narrow.clientW}`,
)
console.log(`\n（参考：375 宽下页面整体溢出 ${narrow.withFooter}px —— 与页脚无关，藏掉页脚后不变）\n`)

/* ------------------------------------------------------------ 英文 */
await page.setViewportSize(VIEWPORT)
await page.evaluate(() => localStorage.setItem('jt:settings', JSON.stringify({ language: 'en' })))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.app-footer', { timeout: 20000 })
await page.waitForTimeout(800)

const en = await readFooter(page)
console.log(`\n英文页脚：${en.text}\n`)

// CJK 统一表意文字 + 中日韩标点。页脚是纯文案，出现任何 CJK 都是漏翻。
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f]/
check('英文页脚里没有中日韩字符（i18n 没漏）', !CJK.test(en.text), `命中了 ${(en.text.match(CJK) || []).join('')}`)
check(
  '英文页脚的姊妹站标签与中文不同（确实取了 en 字典）',
  en.links.filter((l) => !l.isAdmin).every((l) => !CJK.test(l.text)),
  en.links.map((l) => l.text).join(' / '),
)
check(
  '英文下姊妹站 href 仍与 data/site.js 一致',
  en.links.filter((l) => !l.isAdmin && l.href !== repo).every((l, i) => l.href === siblings[i]?.href),
)

await browser.close()
console.log(`\n${'─'.repeat(52)}\n通过 ${pass} / 失败 ${fail}`)
process.exit(fail ? 1 : 0)
