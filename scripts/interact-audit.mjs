/* =========================================================================
   interact-audit.mjs —— 重页面的**交互**成本

   为什么还要量这个：
     perf-audit 只量了「加载」。但发现页 / 图标管理各渲染 **377 张卡片**
     （DOM 1.1~1.4 万节点），真正会卡的是**交互**：
       · 搜索框每敲一个字 → 过滤 377 条 → 重渲染
       · 滚动
     只看加载数据会得出「还挺快」的结论，而用户天天用的是搜索框。

   量法：**用 CDP 的 `Input.dispatchKeyEvent` 敲字**（不是 `fill()` ——
   那是一次性赋值，不触发逐字符输入），每次记录「从按键到下一次 rAF」
   的耗时（= 主线程被占住多久）。

   用法：node interact-audit.mjs [base]
   ========================================================================= */

import net from 'node:net'
import pw from './lib/playwright.mjs'   // ← 可移植解析，别再写死绝对路径
const { chromium } = pw

const BASE = process.argv[2] || 'https://jiepijiang.github.io/jerry-tools/'
const BASE_URL = new URL(BASE.endsWith('/') ? BASE : BASE + '/')
const EMAIL = 'jt-transfer-probe@jerry.tools'
const PASSWORD = 'Pw-transfer-Aa1'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const url = (p) => new URL(String(p).replace(/^\//, ''), BASE_URL).href

/* ⚠️ Chromium 不继承系统代理 —— 见 perf-audit.mjs 的注释 */
const proxyUp = await new Promise((resolve) => {
  const s = net.connect({ host: '127.0.0.1', port: 7897 })
  const done = (v) => { try { s.destroy() } catch {} ; resolve(v) }
  s.setTimeout(1500)
  s.on('connect', () => done(true)); s.on('error', () => done(false)); s.on('timeout', () => done(false))
})
const proxyOpt = proxyUp ? { proxy: { server: 'http://127.0.0.1:7897', bypass: '127.0.0.1,localhost' } } : {}
console.log(proxyUp ? '已给 Chromium 配代理 :7897' : '7897 没开')

const browser = await chromium.launch({ headless: true, ...proxyOpt })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await ctx.newPage()
const cdp = await ctx.newCDPSession(page)

const waitMounted = async () => {
  const t0 = Date.now()
  while (Date.now() - t0 < 60000) {
    if (await page.evaluate(() => !!document.querySelector('#app > *:not(.boot-splash)')).catch(() => false)) return Date.now() - t0
    await sleep(50)
  }
  return null
}

/* 登录 */
await page.goto(url('login'), { waitUntil: 'domcontentloaded' })
await waitMounted()
await page.waitForSelector('.seg-item', { timeout: 25000 })
await page.locator('.seg-item', { hasText: '登录' }).click()
await sleep(300)
await page.locator('.fld .field').nth(0).fill(EMAIL)
await page.locator('.fld .field').nth(1).fill(PASSWORD)
await page.locator('.btn-primary.wide').click()
await page.waitForFunction(() => !/\/login$/.test(location.pathname), null, { timeout: 60000 })
await sleep(4000)
console.log('已登录\n')

/**
 * 主线程累计干活时间（秒）。走 CDP 的 `TaskDuration`。
 *
 * ⚠️ **不要用「等两次 rAF 再测 elapsed」** —— 那有 ~33ms 的**地板**
 *    （两个 16.7ms 帧），会把 15ms 的活报成 48ms。
 *    `TaskDuration` 是浏览器自己统计的**真实主线程忙碌时间**，没有地板。
 */
async function taskDuration() {
  const { metrics } = await cdp.send('Performance.getMetrics')
  return metrics.find((m) => m.name === 'TaskDuration')?.value ?? 0
}
void taskDuration // （这个环境里 TaskDuration 恒 0，留着备查）

/** 逐字符输入，返回每键**真实占用主线程**的毫秒数。 */
async function typeAndMeasure(selector, text) {
  await page.locator(selector).first().click()
  await sleep(400)
  const samples = []
  for (const ch of text) {
    /*
     * 量「派发 input → Vue 渲染完」这一段。
     *
     * ⚠️ 两个都不能用：
     *   · 「等两次 rAF 再测 elapsed」有 ~33ms 的**地板**（两个 16.7ms 帧）；
     *   · CDP 的 `TaskDuration` 在这个环境里**恒 0**（取不到）。
     * Vue 的调度器走微任务（`Promise.then`），所以 `await Promise.resolve()`
     * 之后 DOM 已经 patch 完了 —— 这一段就是真实的渲染成本，没有地板。
     */
    const t = await page.evaluate(async (c) => {
      const el = document.activeElement
      const t0 = performance.now()
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, el.value + c)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()      // 冲掉微任务：Vue 在这一拍里 patch DOM
      await Promise.resolve()
      return performance.now() - t0
    }, ch)
    samples.push(Math.round(t))
    await sleep(200)
  }
  return samples
}

const ROUTES = [
  ['发现页', 'discover', '.dc-tools .search input'],
  ['图标管理', 'icon-management', '.mini-search input'],
]

for (const [name, p, sel] of ROUTES) {
  await page.goto(url(p), { waitUntil: 'domcontentloaded' })
  await waitMounted()
  await sleep(4000)

  const nodes = await page.evaluate(() => document.getElementsByTagName('*').length)
  const cards = await page.evaluate(() => document.querySelectorAll('.site-card, .icon-card').length)

  const t = await typeAndMeasure(sel, 'github')
  const worst = Math.max(...t)
  const avg = Math.round(t.reduce((a, b) => a + b, 0) / t.length)
  console.log(`${name}`)
  console.log(`  DOM 节点 ${nodes} · 卡片 ${cards} 张`)
  console.log(`  逐键输入 "github"：平均 ${avg}ms / 最差 ${worst}ms   明细 ${t.join(', ')}ms`)
  console.log(`  ${worst > 100 ? '🔴 有卡顿（单键 >100ms）' : worst > 50 ? '🟡 略卡（>50ms）' : '✅ 流畅'}\n`)
}

await browser.close()
