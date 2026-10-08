/**
 * sites-source.mjs —— 验证「发现页的数据到底从哪来」。
 *
 * 背景：`active` 适配器只在**登录之后**才切到云端（`useCloudStorage()` 唯一的
 * 调用点是 `useAuth.enterCloudMode()`），所以未登录访客读的是本地 `jt:sites` ——
 * 第一次访问灌进去的、**打包在 JS 里的种子快照**。
 * 而 `sites` **不在 `SEED_ADDITIONS` 里**，那份快照**永远不会更新**：
 * Jerry 在后台审核通过的新站点，未登录访客永远看不到。
 *
 * 修法见 `useStore.refreshSitesFromCloud()`：绕开 `active` 直接读云端，
 * 挂载后补一次，**先渲染种子、云端到了再覆盖**。
 *
 * 四个场景，**缺一不可**：
 *
 *   ① 匿名 + 云端正常 → **先种子占位**，云端到了**再覆盖**（两段都验）
 *   ② 匿名 + 云端读失败 → 必须**保持种子**（377 张），不是空
 *   ③ 本机模式（没配 Supabase）→ **不该**发云端请求，种子照常显示
 *   ④ 已登录 → `discover_sites` 只读 **1 次**（loadAll 那次；补读不该重复打）
 *
 * 🔴 ① 的判据是**「拦截响应、塞一条可辨识的行，看它有没有出现在页面上」**，
 *    不是「发过请求」—— 后者证明不了渲染用的是哪份数据。
 *    这条是这次的关键：我最初就是靠「读代码推断」得出「种子零使用」的错误结论，
 *    探针一跑就翻了（见 README 里 seed-lazy 那段）。
 *
 *    ⚠️ ① 还要**把云端响应压后 4 秒**才验得出「先种子」这一段 ——
 *    不压后的话云端可能瞬间就到，分不清「种子先渲染过」还是
 *    「一开始就是空的、直接被云端填上」。
 *
 * 用法（要两个服务）：
 *   npm run build && npm run build:nosb
 *   npm run serve:dist                                          # 5200 云端模式
 *   node scripts/serve-static.mjs dist-nosb /jerry-tools/ 5201   # 5201 本机模式
 *   node scripts/sites-source.mjs
 */
import pw from './lib/playwright.mjs'

const CLOUD_BASE = process.argv[2] || 'http://127.0.0.1:5200/jerry-tools/'
const LOCAL_BASE = process.argv[3] || 'http://127.0.0.1:5201/jerry-tools/'

const PROBE_EMAIL = process.env.PROBE_EMAIL || 'jt-transfer-probe@jerry.tools'
const PROBE_PASSWORD = process.env.PROBE_PASSWORD || 'Pw-transfer-Aa1'

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
 *    这台机器直连时常断，只有 Clash 7897 稳定。
 *    localhost 必须 bypass，否则连本地静态服务也绕出去。
 */
const proxyOpt = process.env.NO_PROXY_BROWSER
  ? {}
  : { proxy: { server: 'http://127.0.0.1:7897', bypass: '127.0.0.1,localhost' } }

async function waitAppReady(page, timeout = 40000) {
  // ⚠️ 不能只等「#app 非空」—— index.html 的首屏占位也在 #app 里
  await page.waitForFunction(
    () => !!document.querySelector('#app > *:not(.boot-splash)'),
    null,
    { timeout },
  )
}

/** 云端 `discover_sites` 的假响应 —— 一条**可辨识**的行，用来证明渲染来源。 */
const FAKE_ROWS = [
  {
    id: '__probe_cloud_1',
    title: 'CLOUD-PROBE-ONLY',
    url: 'https://cloud-probe.example/',
    description: '这条只存在于被拦截的云端响应里',
    icon: '',
    category: 'AI',
    subcategory: '',
    views: 1,
    collects: 0,
    status: 'approved',
    submitted_by: null,
    created_at: '2026-01-01',
  },
]

const SEED_CARD_COUNT = 377

function newPage(browser) {
  return browser.newContext({ viewport: { width: 1440, height: 1000 } }).then((ctx) => ctx.newPage())
}

/* ---------------------------------------------------------------- ① */
async function sceneCloudOk(browser) {
  section('① 匿名 + 云端正常 → 先种子占位，云端到了再覆盖')

  const page = await newPage(browser)
  const reqs = []
  page.on('request', (r) => reqs.push(r.url()))

  /*
   * 🔴 故意**把云端响应压后 4 秒**。
   *
   * 不压后的话，云端数据可能在 mount 那一瞬就到了 —— 我就分不清
   * 「种子先渲染过、然后被覆盖」还是「一开始就是空的、直接被云端填上」。
   * 而「**先种子**」恰恰是这次设计的核心：未登录访客的 boot 现在是纯本地的
   * （适配器就是 localStorage），不能为了读云端把首屏堵住。
   * 所以这一段必须单独验，不能只看最终结果。
   */
  await page.route('**/rest/v1/discover_sites*', async (route) => {
    await sleep(4000)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(FAKE_ROWS),
    })
  })

  await page.goto(new URL('discover', CLOUD_BASE).href, { waitUntil: 'domcontentloaded' })
  await waitAppReady(page)

  // 云端还没回来 —— 这一刻必须**已经是种子**，不能是空、也不能是加载态
  await sleep(800)
  const earlyCards = await page.locator('.site-card').count()
  const earlyEmpty = await page.locator('.dc-empty').count()
  console.log(`     云端未回时：卡片 ${earlyCards} 张 · 空态 ${earlyEmpty} 个`)
  check(
    '云端还没回来时就已经是种子占位（不是空态、不是一直加载）',
    earlyCards === SEED_CARD_COUNT,
    `${earlyCards} 张 / 空态 ${earlyEmpty}`,
  )

  // 云端到了 → 覆盖掉种子
  const ok = await page
    .waitForFunction(
      () => [...document.querySelectorAll('.sc-title')].some((e) => e.textContent.includes('CLOUD-PROBE-ONLY')),
      null,
      { timeout: 25000 },
    )
    .then(() => true)
    .catch(() => false)

  const titles = await page.locator('.sc-title').allInnerTexts()
  console.log(`     云端回来后：${JSON.stringify(titles.slice(0, 4))}`)

  check('云端数据到了之后覆盖掉种子（显示的是云端响应那条）', ok, JSON.stringify(titles.slice(0, 3)))
  check('确实打了云端 `discover_sites`', reqs.some((u) => /rest\/v1\/discover_sites/.test(u)))
  await page.context().close()
}

/* ---------------------------------------------------------------- ② */
async function sceneCloudFails(browser) {
  section('② 匿名 + 云端读失败 → 必须保持种子，不能变空')

  const page = await newPage(browser)
  await page.route('**/rest/v1/discover_sites*', (route) => route.abort())

  await page.goto(new URL('discover', CLOUD_BASE).href, { waitUntil: 'domcontentloaded' })
  await waitAppReady(page)
  await page.waitForSelector('.site-card, .dc-empty', { timeout: 25000 }).catch(() => {})
  await sleep(4000) // 给补读留出失败的时间

  const cards = await page.locator('.site-card').count()
  const empty = await page.locator('.dc-empty').count()
  console.log(`     卡片 ${cards} 张 · 空态 ${empty} 个`)

  check('云端读失败后仍是种子兜底（不是空）', cards === SEED_CARD_COUNT, `${cards} 张`)
  check('没有掉进空态', empty === 0)
  await page.context().close()
}

/* ---------------------------------------------------------------- ③ */
async function sceneLocalMode(browser) {
  section('③ 本机模式（没配 Supabase）→ 不该发云端请求')

  const page = await newPage(browser)
  const reqs = []
  page.on('request', (r) => reqs.push(r.url()))

  await page.goto(new URL('discover', LOCAL_BASE).href, { waitUntil: 'domcontentloaded' })
  await waitAppReady(page)
  await page.waitForSelector('.site-card, .dc-empty', { timeout: 25000 }).catch(() => {})
  await sleep(3000)

  const cards = await page.locator('.site-card').count()
  const cloudReqs = reqs.filter((u) => /rest\/v1\/discover_sites/.test(u))
  console.log(`     卡片 ${cards} 张 · 云端 discover_sites 请求 ${cloudReqs.length} 次`)

  check('本机模式不发云端 discover_sites 请求', cloudReqs.length === 0, `${cloudReqs.length} 次`)
  check('种子照常显示 377 张', cards === SEED_CARD_COUNT, `${cards} 张`)
  await page.context().close()
}

/* ---------------------------------------------------------------- ④ */
async function sceneLoggedIn(browser) {
  section('④ 已登录 → `discover_sites` 只该读 1 次（补读不该重复打）')

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()

  await page.goto(new URL('login', CLOUD_BASE).href, { waitUntil: 'domcontentloaded' })
  await waitAppReady(page)
  await sleep(1500)

  const inputs = page.locator('input')
  const n = await inputs.count()
  if (n < 2) {
    check('登录表单出现了', false, `只有 ${n} 个 input`)
    await ctx.close()
    return
  }
  // 邮箱是第一个文本类 input，密码是 type=password
  await inputs.nth(0).fill(PROBE_EMAIL)
  const pwd = page.locator('input[type="password"]').first()
  await pwd.fill(PROBE_PASSWORD)
  await pwd.press('Enter')

  const loggedIn = await page
    .waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 30000 })
    .then(() => true)
    .catch(() => false)
  if (!loggedIn) {
    console.log(`     ⚠️ 登录没成功（停在 ${page.url()}）—— 这条跳过，不算失败`)
    await ctx.close()
    return
  }
  console.log('     登录成功')

  // 🔴 关键：**已登录状态下重新整页加载**，这时 bootstrap 走的是
  //    initAuth 恢复会话 → enterCloudMode → 适配器切云端 → loadAll 读一次；
  //    之后 refreshSitesFromCloud() 应该因为 isCloudActive() 直接返回 false。
  const reqs = []
  page.on('request', (r) => reqs.push(r.url()))

  await page.goto(new URL('discover', CLOUD_BASE).href, { waitUntil: 'domcontentloaded' })
  await waitAppReady(page)
  await page.waitForSelector('.site-card, .dc-empty', { timeout: 25000 }).catch(() => {})
  await sleep(4000)

  const cloudReqs = reqs.filter((u) => /rest\/v1\/discover_sites/.test(u))
  const cards = await page.locator('.site-card').count()
  console.log(`     卡片 ${cards} 张 · 云端 discover_sites 请求 ${cloudReqs.length} 次`)

  check('已登录：有卡片', cards > 0, `${cards} 张`)
  check(
    '已登录：`discover_sites` 恰好读 1 次（loadAll 那次；补读被 isCloudActive 挡住）',
    cloudReqs.length === 1,
    `${cloudReqs.length} 次`,
  )
  await ctx.close()
}

const browser = await pw.chromium.launch({ headless: true, ...proxyOpt })
try {
  await sceneCloudOk(browser)
  await sceneCloudFails(browser)
  await sceneLocalMode(browser)
  await sceneLoggedIn(browser)
} finally {
  await browser.close()
}

console.log(`\n合计 ${pass} 通过 / ${fail} 失败`)
if (fail) console.log('失败项：\n  - ' + failures.join('\n  - '))
process.exit(fail ? 1 : 0)
