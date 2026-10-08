/**
 * seed-lazy.mjs —— 验证「377 条发现页种子改成按需加载」这件事**真的成立**。
 *
 * 背景：`src/data/seed-discover.js` 99 KB 源码（gzip 17 KB），
 * 原本被 `useStore.js` **静态 import** → 打进主 chunk → 每个访问者都要下载，
 * 而它**只在 `decide()` 返回 'seed'（读到空、要内存兜底）时才用**。
 * 线上云端表有 377 行 → 走 'use' → 这份数据纯下载、零使用。
 *
 * 改成动态 import 后要验两件事，**缺一不可**：
 *
 *   ① 云端模式（线上那种）→ 种子 chunk **不该**被请求（省下来了）
 *   ② 本机模式（没配 Supabase）→ 种子 chunk **必须**被请求，且 377 条真的显示出来
 *
 * ⚠️ 只验 ① 是不够的 —— 「没请求」也可能是「功能坏了」。
 *    只验 ② 也不够 —— 那正是改动前的行为。
 *
 * 用法：
 *   node seed-lazy.mjs <云端base> <本机模式base>
 *   node seed-lazy.mjs http://127.0.0.1:5200/jerry-tools/ http://127.0.0.1:5201/jerry-tools/
 */
import pw from './lib/playwright.mjs'   // ← 可移植解析，别再写死绝对路径

const CLOUD_BASE = process.argv[2] || 'http://127.0.0.1:5200/jerry-tools/'
const LOCAL_BASE = process.argv[3] || 'http://127.0.0.1:5201/jerry-tools/'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0
let fail = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    failures.push(name)
    console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`)
  }
}
const section = (t) => console.log(`\n【${t}】`)

/* ------------------------------------------------------------------ 代理
 * ⚠️ Playwright 的 Chromium **不继承系统代理、也不读 `http_proxy`**。
 *    这台机器直连时常断（github / supabase 都可能是 000），只有 Clash 7897 通。
 *    不给浏览器配代理的话，云端模式读 discover_sites 会全部失败 ——
 *    然后应用会「读到空」→ 走 'seed' → **种子被请求**，
 *    于是场景 ① 会红，而红的原因根本不是这次的改动。
 *    localhost 必须 bypass，否则连本地静态服务也绕出去。
 */
const PROXY = 'http://127.0.0.1:7897'
const proxyOpt = process.env.NO_PROXY_BROWSER
  ? {}
  : { proxy: { server: PROXY, bypass: '127.0.0.1,localhost' } }

async function waitAppReady(page, timeout = 40000) {
  // ⚠️ 不能只等「#app 非空」—— index.html 里的首屏占位（.boot-splash）也在 #app 里。
  await page.waitForFunction(
    () => !!document.querySelector('#app > *:not(.boot-splash)'),
    null,
    { timeout },
  )
}

async function run({ label, base, expectSeed, expectCards }) {
  section(`${label}（${base}）`)

  const browser = await pw.chromium.launch({ headless: true, ...proxyOpt })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()

  const reqs = []
  page.on('request', (r) => reqs.push(r.url()))
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)))

  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await waitAppReady(page)
  await sleep(2500) // 让 bootstrap 的几轮请求跑完

  // 直接进发现页（整页导航，这样 request 事件能完整抓到）
  await page.goto(new URL('discover', base).href, { waitUntil: 'domcontentloaded' })
  await waitAppReady(page)
  await page.waitForSelector('.site-card, .dc-empty', { timeout: 25000 }).catch(() => {})
  await sleep(3000)

  const cards = await page.locator('.site-card').count()
  const empty = await page.locator('.dc-empty').count()
  const seedReqs = reqs.filter((u) => /seed-discover/i.test(u))

  console.log(`     卡片 ${cards} 张 · 空态 ${empty} 个 · 种子 chunk 请求 ${seedReqs.length} 次`)
  if (seedReqs.length) console.log(`     种子请求：${seedReqs[0]}`)
  if (errs.length) console.log(`     ⚠️ 页面报错：${JSON.stringify(errs.slice(0, 3))}`)

  check(`${label}：发现页有卡片（不是空态）`, cards > 0, `${cards} 张 / 空态 ${empty}`)
  check(
    `${label}：卡片数 ${expectCards}（${expectCards}）`,
    cards === expectCards,
    `${cards}`,
  )
  check(
    `${label}：种子 chunk ${expectSeed ? '**必须**被请求' : '**不该**被请求'}`,
    expectSeed ? seedReqs.length > 0 : seedReqs.length === 0,
    `${seedReqs.length} 次`,
  )
  check(`${label}：没有页面级 JS 报错`, errs.length === 0, JSON.stringify(errs.slice(0, 2)))

  await browser.close()
}

// 云端模式：云端表有 377 行 → decide() 返回 'use' → 种子不该被拉
await run({ label: '① 云端模式', base: CLOUD_BASE, expectSeed: false, expectCards: 377 })

// 本机模式：读到空 → decide() 返回 'seed' → 种子必须被拉，377 条要显示
await run({ label: '② 本机模式', base: LOCAL_BASE, expectSeed: true, expectCards: 377 })

console.log(`\n合计 ${pass} 通过 / ${fail} 失败`)
if (fail) console.log('失败项：\n  - ' + failures.join('\n  - '))
process.exit(fail ? 1 : 0)
