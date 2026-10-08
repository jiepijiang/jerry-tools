/* =========================================================================
   perf-audit.mjs —— 各页面的性能画像（先量再改）

   量什么（每个路由）：
     · 到「应用挂载」的耗时（从外面轮询 #app，不注入任何脚本）
     · FCP / DCL / load（导航计时，load 后读一次即可）
     · DOM 节点数 / JS 堆 / 布局次数（走 CDP 的 Performance domain）

   ⚠️ **故意不用 `addInitScript`。** 踩过两次：
      · `PerformanceObserver({type:'longtask'})` 装在 init script 里会让页面
        **卡在解析阶段** —— `page.goto` 直接超时，看起来像「站点挂了」；
      · 换掉之后仍然超时，说明 init script 这条路本身在这个环境里不可靠。
     从外面量慢一点（挂载时刻只能轮询到 ±50ms），但**稳**，而且够用。

   用法：node perf-audit.mjs [base]   base 默认线上
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

/**
 * ⚠️ **Playwright 的 Chromium 默认不继承系统代理，也不读 `http_proxy` 环境变量。**
 *
 * 2026-10-05 实测：这台机器**直连全断**（github / supabase.co 都是 `000`），
 * 只有 Clash 的 `127.0.0.1:7897` 通。curl 能靠环境变量走代理，
 * 但浏览器里的登录请求是直连的 → **登录页永远「操作失败」**，
 * 表现像「应用坏了」，其实是网络。
 *
 * 做法：探一下 7897 在不在（纯 TCP，Node 的 fetch 自己也不走代理），
 * 在就**显式传给 Chromium**，并把 localhost 加进 bypass
 * （否则连本地 dev server 的请求也会绕出去）。
 */
const PROXY_PORT = 7897
const proxyUp = await new Promise((resolve) => {
  const s = net.connect({ host: '127.0.0.1', port: PROXY_PORT })
  const done = (v) => { try { s.destroy() } catch {} ; resolve(v) }
  s.setTimeout(1500)
  s.on('connect', () => done(true))
  s.on('error', () => done(false))
  s.on('timeout', () => done(false))
})
const proxyOpt = proxyUp
  ? { proxy: { server: `http://127.0.0.1:${PROXY_PORT}`, bypass: '127.0.0.1,localhost' } }
  : {}
console.log(proxyUp ? `已给 Chromium 配代理 :${PROXY_PORT}（bypass localhost）` : '7897 没开，浏览器走直连')

const browser = await chromium.launch({ headless: true, ...proxyOpt })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await ctx.newPage()
const cdp = await ctx.newCDPSession(page)
await cdp.send('Performance.enable')

/** 从外面轮询「应用挂载」，返回毫秒。 */
async function waitMounted(timeout = 60000, step = 50) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const ok = await page.evaluate(() => !!document.querySelector('#app > *:not(.boot-splash)'))
      .catch(() => false)
    if (ok) return Date.now() - t0
    await sleep(step)
  }
  return null
}

const metrics = async () => {
  const { metrics: ms } = await cdp.send('Performance.getMetrics')
  const get = (n) => ms.find((m) => m.name === n)?.value ?? null
  return {
    nodes: get('Nodes'),
    heapMB: get('JSHeapUsedSize') != null ? Math.round(get('JSHeapUsedSize') / 1048576) : null,
    layouts: get('LayoutCount'),
  }
}

/* 登录（后面的页面才有数据可渲染） */
await page.goto(url('login'), { waitUntil: 'domcontentloaded' })
if ((await waitMounted()) == null) { console.log('❌ 登录页没挂载，中止'); await browser.close(); process.exit(1) }
await page.waitForSelector('.seg-item', { timeout: 25000 })
await page.locator('.seg-item', { hasText: '登录' }).click()
await sleep(300)
await page.locator('.fld .field').nth(0).fill(EMAIL)
await page.locator('.fld .field').nth(1).fill(PASSWORD)
await page.locator('.btn-primary.wide').click()
await page.waitForFunction(() => !/\/login$/.test(location.pathname), null, { timeout: 60000 })
await sleep(4000)
console.log('已登录\n')

const ROUTES = [
  ['首页', ''],
  ['发现页', 'discover'],
  ['图标管理', 'icon-management'],
  ['管理后台', 'admin'],
  ['登录/资料', 'login'],
]

console.log('路由'.padEnd(12) + '挂载'.padStart(8) + 'FCP'.padStart(8) + 'DCL'.padStart(8) +
  'load'.padStart(8) + 'DOM'.padStart(8) + '堆MB'.padStart(8) + '布局'.padStart(8))

for (const [name, p] of ROUTES) {
  await page.goto(url(p), { waitUntil: 'domcontentloaded' })
  const mounted = await waitMounted()
  await sleep(4000) // 等数据读完、渲染稳定

  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] || {}
    const paints = performance.getEntriesByType('paint') || []
    const fcp = paints.find((x) => x.name === 'first-contentful-paint')
    return {
      fcp: fcp ? fcp.startTime : null,
      dcl: n.domContentLoadedEventEnd ?? null,
      load: n.loadEventEnd ?? null,
    }
  })
  const m = await metrics()
  const fmt = (v) => (v == null ? '—' : String(Math.round(v)))  // ← 必须返回字符串，padStart 只对字符串有
  console.log(
    name.padEnd(12) + fmt(mounted).padStart(8) + fmt(nav.fcp).padStart(8) +
    fmt(nav.dcl).padStart(8) + fmt(nav.load).padStart(8) +
    String(m.nodes ?? '—').padStart(8) + String(m.heapMB ?? '—').padStart(8) +
    String(m.layouts ?? '—').padStart(8),
  )
}

await browser.close()
