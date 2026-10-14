/* =========================================================================
   probe-icon-source.mjs —— 书签「图标来源」三选一端到端守卫
   -------------------------------------------------------------------------
   2026-10-14 给书签加了 `iconMode`（initial / favicon / custom），
   并在添加/编辑弹窗里做成显式三选一。这个脚本走**真 UI** 验证整条链路：

     选来源 → 存进 localStorage → 卡片按选的方式渲染

   为什么必须走 UI、不能只测 `helpers.js`：
     `probe-icon-mode.mjs` 已经证明了 `iconSrcFor()` 的语义正确，
     但**存得进去吗**是另一回事 —— `useStore.createBookmark()` 是
     **逐字段构造对象**的，漏一个字段就是静默丢失（弹窗传了也没用）。
     这个脚本的第一批断言就是冲着那个来的。

   ── 判据 ──────────────────────────────────────────────────────────

     ① 弹窗里有 3 个来源选项（不是隐式的先后关系了）
     ② 每种来源选完 → 存下来的 `iconMode` / `icon` 就是它
        （**抓 createBookmark 丢字段**）
     ③ initial → 卡片上**没有** <img>（只剩字母块）
     ④ favicon → **弹窗预览**和**卡片**都指向「页面里声明的真图标」，
                  不是猜出来的 `/favicon.ico`
     ⑤ favicon 但页面没声明图标 → 回落 `/favicon.ico`（老行为不能丢）
     ⑥ custom  → 卡片 <img> 指向填的那个地址
     ⑦ 编辑时切回 initial → `icon` 被**清空**（不留旧地址在数据里）
     ⑧ **存量数据回填** —— 直接往存储里塞「icon 为空的 favicon 书签」再刷新，
        必须自动补上真图标；同时**不能**动 initial / custom / 已有图标的条目
        （这一条覆盖的是「修好**已有**书签」的那一半，①~⑦ 只覆盖新数据）
     ⑨ **状态字时间线单调** —— 不能出现「已获取站点图标」又退回「正在获取站点图标…」，
        而且「声明了真图标」的用例里预览 src 历史里一次都不该出现猜的 `/favicon.ico`。
        （2026-10-14 第四轮修的「预览假绿闪烁」，假绿只持续 **64ms** —— 见 ⑨ 的注释）

   ══ ⚠️ 四个必须知道的坑（都是实测踩出来的）════════════════════════

   【坑 1】`/favicon.ico` 这个路径**绕不过 page.route，也不发 request 事件**

     它由 Chromium 的 favicon 服务在**浏览器进程**里单独抓，不经过渲染进程 ——
     所以拿 favicon 路径去注册 `page.route` 一次都不会命中，`page.on('request')`
     也看不到它。实测（`https://127.0.0.1:5201/favicon.ico`，服务端日志里
     收到两次请求、`<img>` 正常 onload，但 Playwright 侧零事件）：

       路径                    REQ 事件   能被 route 拦   结果
       /favicon.ico            ✗          ✗             由服务端真实响应决定
       /favicon.ico?x=1        ✓          ✓             ← 带 query 就正常了
       /sub/favicon.ico        ✗          ✗
       /other.ico              ✓          ✓
       /custom-icon.png        ✓          ✓

     **后果**：想「喂一张假 favicon 让断言能观察」这条路走不通 ——
     必须让那个 origin **真的**提供一个 `/favicon.ico`。
     所以下面起了个自带的极小服务（`startIconServer()`）。

   【坑 2】`BookmarkIcon.vue` 在 <img> onerror 时会把图片**从 DOM 移除**
     （`showImage = !!src && !failed`）。所以只要图标加载失败，
     ③④⑤⑥ 全都会退化成「没有图」—— 各种来源**分不出来**，断言恒真。
     喂得到真图是这个脚本有意义的前提。

   【坑 3】第二轮（2026-10-14）：favicon 模式**不再猜 `/favicon.ico`**，
     改成读页面 HTML 里的 `<link rel="icon">`。于是需要两个「站点」：

       · `startIconServer()`  真 http 服务 —— 提供真 `/favicon.ico`（坑 1）
                              和「一个没声明图标的页面」（测⑤的兜底）
       · `icon.test` 路由伪造 —— 一个**声明了真图标**的 https 站点

     ⚠️ 伪造的那个为什么必须是 **https**：`isUsableIcon()` 会挡掉明文 http
        （防 Mixed Content）。本机 http 服务给出的真图标地址会被判为不合格、
        又回落到 `/favicon.ico` —— 那样就**测不到修复本身**了。
        `icon.test` 解析不了没关系：请求由 `page.route` 直接 fulfill，不做 DNS。

   【坑 4】⚠️⚠️ **只要注册了 `page.route`，`/favicon.ico` 的 `<img>` 就一定失败**

     2026-10-14 实测（本脚本踩到，`scripts/_dbg4.mjs` 复现）：

       状态                          new Image(SITE + '/favicon.ico')
       注册了 page.route             error        ← 请求**根本不发**，也没有 requestfailed 事件
       page.unroute() 之后           load 1
       全新页面（从没注册过 route）    load 1

     这是坑 1 的延伸：那个路径由浏览器进程的 favicon 服务接管，
     而 `page.route` 打开的是渲染进程侧的拦截 —— 两边对不上，
     请求既走不到真服务、也走不到 fulfill，直接判失败。

     **后果**：**不能**在「测 `/favicon.ico` 兜底」的用例上挂着路由。
     所以下面的 `CASES` 每条都带 `needsRoute`，循环里**按需开关**：
     只有「页面声明了真图标」那条会开路由，跑完立刻 `unroute`。
     新加用例时**必须**想清楚它要不要这个开关 —— 挂错了会红得莫名其妙。

   ── 自定义图标为什么用 data URL ──────────────────────────────────

     `isUsableIcon()` 只放行 **https**（和站内路径 / data:）。
     本机服务是 http，拿它当自定义图标地址会被判为不合格 → 回落站点图标，
     断言就测不到 custom 分支了。data URL 走的是同一条「合格地址」路径，
     又不需要证书，最省事。

   用法：node scripts/probe-icon-source.mjs [base]
        默认 http://127.0.0.1:5200/jerry-tools/（先 npm run build && npm run serve:dist）
   ========================================================================= */

import { createServer } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import pw from './lib/playwright.mjs'

const { chromium } = pw
const BASE = process.argv[2] || 'http://127.0.0.1:5200/jerry-tools/'

/** 1×1 透明 PNG。既是两个「站点」的图标响应体，也是自定义图标的 data URL 载荷。 */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG = Buffer.from(PNG_B64, 'base64')
const DATA_URL = `data:image/png;base64,${PNG_B64}`

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

/* ------------------------------------------------------------------ */
/* 自带站点 A：真 http 服务（坑 1 —— /favicon.ico 只能靠真响应）        */
/* ------------------------------------------------------------------ */

/** 站点 A 的 HTML 响应延迟。见 `startIconServer` 里的注释。 */
const SLOW_MS = 600

function startIconServer() {
  return new Promise((resolve) => {
    const srv = createServer(async (req, res) => {
      const { pathname } = new URL(req.url, 'http://127.0.0.1')
      const cors = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }
      if (/\.(ico|png)$/i.test(pathname)) {
        res.writeHead(200, { ...cors, 'content-type': 'image/png' })
        res.end(PNG)
        return
      }
      /*
       * 「没有声明图标的页面」故意**慢 600ms**。
       *
       * ⚠️ 这个延迟是让 ⑨a（状态字时间线单调）**有判别力**的必要条件。
       *    本地服务原本是毫秒级的，`runResolve` 一眨眼就跑完 —— 倒退窗口
       *    只有 ~3ms，40ms 的采样根本抓不到，⑨a 会退化成**恒真断言**
       *    （实测踩过两次，见 ⑨a 的注释）。600ms 也更接近真实站点：
       *    真网络一次 HTML 往返就是几百毫秒。
       *
       * ⚠️ 只对 HTML 路径加，图片路径不加 —— 图片慢会改变 `<img>` 自己的
       *    load 时序，那是另一件事。
       */
      await sleep(SLOW_MS)
      // 其余路径 = 「一个没有声明图标的页面」，用来测⑤的兜底
      res.writeHead(200, { ...cors, 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><html><head><title>no icon here</title></head><body>ok</body></html>')
    })
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }))
  })
}

const { srv, port } = await startIconServer()
/** 站点 A 的根。它的 `/favicon.ico` 是真图（所以「猜出来的地址」也能加载成功）。 */
const SITE = `http://127.0.0.1:${port}/`

/* ------------------------------------------------------------------ */
/* 站点 B：伪造的 https 站点（坑 3 —— 声明了真图标）                    */
/* ------------------------------------------------------------------ */

const ICON_HOST = 'https://icon.test'
/** 页面里 `<link rel="icon">` 声明的地址 —— **这才是我们要抓的**。 */
const DECLARED_ICON = `${ICON_HOST}/assets/declared-icon.png`
/*
 * 猜出来的地址（`origin + /favicon.ico`，也就是 `${ICON_HOST}/favicon.ico`）
 * —— 这次修复要**避免**用到它。上面那个 handler 特意让它也能返回真图，
 * 所以万一修复被改回去，卡片会明确地指向它，而不是退化成「没有 <img>」。
 */

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })

/*
 * ⚠️ 每个 fulfill 都要带 `access-control-allow-origin: *` —— 应用页在
 *    `127.0.0.1:5200`，去 fetch `icon.test` 是**跨域**，缺这个头浏览器会拦掉，
 *    `resolveSiteIcon()` 就只能静默返回空（表现是「测不出修复」而不是「报错」）。
 *
 * ⚠️ `.ico` / `.png` 一律回真图：这样「猜出来的地址」是**能加载成功的**。
 *    万一修复被改回去，卡片会**明确地**指向 `/favicon.ico`（红得清楚），
 *    而不是因为图挂了被 `BookmarkIcon` 从 DOM 摘掉、退化成「没有 <img>」。
 *
 * ⚠️ 路由必须**按需开关**（坑 4）—— 这里是具名函数，`unroute` 要按引用匹配。
 */
const ICON_HOST_RE = /^https:\/\/icon\.test\//

function iconHostHandler(route) {
  const { pathname } = new URL(route.request().url())
  const cors = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }
  if (/\.(ico|png)$/i.test(pathname)) {
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'image/png' }, body: PNG })
  }
  return route.fulfill({
    status: 200,
    headers: { ...cors, 'content-type': 'text/html; charset=utf-8' },
    body: [
      '<!doctype html><html><head><meta charset="utf-8"><title>fake site</title>',
      '<link rel="icon" href="/assets/declared-icon.png" type="image/png" />',
      '</head><body>ok</body></html>',
    ].join(''),
  })
}

let routed = false
/** 按需开关 `icon.test` 的路由。见坑 4 —— 挂着它的时候 `/favicon.ico` 一定失败。 */
async function setRoute(on) {
  if (on === routed) return
  if (on) await page.route(ICON_HOST_RE, iconHostHandler)
  else await page.unroute(ICON_HOST_RE, iconHostHandler)
  routed = on
}

/**
 * 四个用例。
 *
 * `segIndex` 就是弹窗里 `.seg-btn` 的下标 —— 与
 * `BookmarkDialog.vue` 的 `ICON_MODE_OPTIONS` 顺序（首字母 / 网站图标 / 自定义）
 * 一一对应。改那个数组的顺序就要改这里（探针会当场红，不会静默错位）。
 *
 * `needsRoute`：这条用例要不要那个伪造的 https 站点。
 * ⚠️ 判据是「**这条用例会不会去看 `/favicon.ico`**」——
 *    会看的一律 `false`，否则会踩坑 4 红得莫名其妙。
 */
const CASES = [
  {
    segIndex: 0,
    needsRoute: false,
    id: 'initial',
    name: 'ZZ首字母',
    url: `${SITE}initial-page/`,
    icon: '',
    wantMode: 'initial',
    wantImg: null, // null = 卡片上不该有 <img>
    wantStored: '', // initial 一律把 icon 清空
  },
  {
    segIndex: 1,
    needsRoute: true,
    id: 'favicon → 抓页面声明的真图标',
    name: 'ZZ真图标',
    url: `${ICON_HOST}/declared/`,
    icon: '',
    wantMode: 'favicon',
    // 这一条就是「填主站链接抓到 Vue 图标」那个 bug 的判据：
    // 必须是页面**声明的**那个地址，而不是 origin + /favicon.ico
    wantImg: DECLARED_ICON,
    wantStored: DECLARED_ICON,
  },
  {
    segIndex: 1,
    needsRoute: false, // ⚠️ 这条要看 /favicon.ico —— 不能挂路由（坑 4）
    /*
     * ⚠️ 这条同时是 ⑨a 的**唯一**判别用例：只有它满足「猜的兜底地址**能加载成功**
     *    （站点 A 真的提供 `/favicon.ico`）+ 解析耗时足够长（HTML 延迟 600ms）」。
     *    另一条 favicon 用例挂着路由，猜的地址被坑 4 打死，⑨a 在它上面**恒真**。
     */
    id: `favicon → 页面没声明 + 响应慢 ${SLOW_MS}ms，回落 /favicon.ico`,
    name: 'ZZ兜底',
    url: `${SITE}no-icon-page/`,
    icon: '',
    wantMode: 'favicon',
    wantImg: `${SITE}favicon.ico`,
    wantStored: '', // 没解析到 → 什么都不写，渲染时才回落
  },
  {
    segIndex: 2,
    needsRoute: false,
    id: 'custom',
    name: 'ZZ自定义',
    url: `${SITE}custom-page/`,
    icon: DATA_URL,
    wantMode: 'custom',
    wantImg: DATA_URL,
    wantStored: DATA_URL,
  },
]

console.log(`\n基线：${BASE}\n站点 A（真 http，提供真 /favicon.ico）：${SITE}\n站点 B（伪造 https，声明真图标）：${DECLARED_ICON}\n`)

/* ------------------------------------------------------------------ */
/* 准备：新建的 context 本来就是空存储 → 直接打开即走「首次访问灌种子」  */
/* ------------------------------------------------------------------ */

/*
 * ⚠️ 不要写 `localStorage.clear()` + `reload()` 来「重置」。
 *
 *    实测会踩一个竞态：清空的瞬间，**上一个页面的异步落盘还在飞**，
 *    它随后把 `jt:seedVersion` 又写回来（而 `jt:bookmarks` 已经被清掉了）。
 *    重载后 `seedIfEmpty()` 看到 `seedVersion` 存在 → 判成「这台设备灌过种子」
 *    → 书签走 `keep` 分支**不补种子** → 页面 0 张卡片，
 *    探针卡在 `waitForSelector('.bm-card')` 超时，而报错信息完全指不到这里。
 *
 *    `browser.newPage()` 开的 context 存储天然是空的，直接 `goto` 就是冷启动，
 *    不需要也不应该手动清。
 */
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bm-card', { timeout: 25000 })

// 默认 editMode=false（options.js），点一下变 true
await page.locator('.tb-right .tb-btn').first().click()
await page.waitForTimeout(200)

const addBtn = page.locator('.tb-right .tb-btn').nth(1)
check('编辑模式已开启（工具条出现第 2 个按钮）', (await addBtn.count()) === 1, `拿到 ${await addBtn.count()} 个`)

const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('jt:bookmarks') || '[]'))
const findByName = async (name) => (await stored()).find((b) => b.name === name) || null

/** 卡片上的图标地址。返回 null = 卡片上没有 <img>（字母块模式）。 */
async function cardImgSrc(name) {
  const img = page.locator('.bm-card', { hasText: name }).locator('.bm-icon img')
  if ((await img.count()) === 0) return null
  return img.first().getAttribute('src')
}

/** 弹窗预览框里的图标地址。null = 没有 <img>。 */
async function previewImgSrc() {
  const img = page.locator('.bm-form .bm-icon img')
  if ((await img.count()) === 0) return null
  return img.first().getAttribute('src')
}

/** 等某张卡片上的图标地址变成期望值。返回是否等到了。 */
async function waitCardImgSrc(name, want, timeout = 15000) {
  return page
    .waitForFunction(
      ({ n, w }) => {
        const card = [...document.querySelectorAll('.bm-card')].find((c) => c.textContent.includes(n))
        return card?.querySelector('.bm-icon img')?.getAttribute('src') === w
      },
      { n: name, w: want },
      { timeout },
    )
    .then(() => true)
    .catch(() => false)
}

/**
 * 等预览框里的地址变成期望值。
 *
 * ⚠️ 不能只等 `.icon-status.ok` —— 那只能说明「有一张图加载成功了」，
 *    解析出真图标**之前**用的是兜底地址 `/favicon.ico`，它也是能加载成功的
 *    （坑 3 特意让它是真图）。必须直接等地址本身。
 */
function waitPreviewSrc(want, timeout = 8000) {
  return page
    .waitForFunction(
      (w) => document.querySelector('.bm-form .bm-icon img')?.getAttribute('src') === w,
      want,
      { timeout },
    )
    .then(() => true)
    .catch(() => false)
}

/* ------------------------------------------------------------------ */
/* 逐种来源走一遍                                                      */
/* ------------------------------------------------------------------ */

for (const c of CASES) {
  console.log(`\n· ${c.id} —— ${c.name}`)

  // ⚠️ 必须在开弹窗**之前**开关路由：坑 4，挂着路由时 `/favicon.ico` 一定失败
  await setRoute(c.needsRoute)

  await page.locator('.tb-right .tb-btn').nth(1).click()
  await page.waitForSelector('.bm-form', { timeout: 15000 })

  const segs = page.locator('.bm-form .seg-btn')
  const segCount = await segs.count()
  check('① 弹窗里有 3 个来源选项', segCount === 3, `拿到 ${segCount} 个`)

  await segs.nth(c.segIndex).click()

  /*
   * ⑨ 的采样器 —— 装在这个位置（切完来源、**填网址之前**）。
   *
   * ⚠️ 必须早于填网址：要抓的正是「解析还没回来」那一段。
   *    装晚了就只剩一个终态，永远看不出倒退。
   * ⚠️ 用**页内** `setInterval` 而不是 Playwright 侧轮询：侧轮询每次都要过
   *    一遍 CDP，采样间隔会被拉到几百毫秒 —— 实测那个假绿只持续 **64ms**，
   *    侧轮询直接漏掉（150ms 采不到，页内 40ms 采得到）。
   */
  if (c.segIndex === 1) {
    await page.evaluate(() => {
      window.__iconTrace = []
      const tick = () => {
        const el = document.querySelector('.bm-form .icon-status')
        const img = document.querySelector('.bm-form .bm-icon img')
        window.__iconTrace.push({
          t: Math.round(performance.now()),
          cls: el ? el.className.replace('icon-status', '').trim() : '',
          src: img ? img.getAttribute('src') : '',
        })
      }
      tick()
      window.__iconTraceTimer = setInterval(tick, 40)
    })
  }

  /*
   * `.bm-form input.field` 的顺序由模板决定：
   *   [自定义时] 图标地址 → 名称 → 网址 → 简介
   *   [其余]             名称 → 网址 → 简介
   * 个数本身也是一条断言（自定义模式才该多出图标输入框）。
   */
  const inputs = page.locator('.bm-form input.field')
  const expectInputs = c.segIndex === 2 ? 4 : 3
  const gotInputs = await inputs.count()
  check(
    `弹窗输入框个数（${c.segIndex === 2 ? '自定义含图标地址' : '非自定义'}）`,
    gotInputs === expectInputs,
    `期望 ${expectInputs}，实际 ${gotInputs}`,
  )

  const off = c.segIndex === 2 ? 1 : 0
  if (c.segIndex === 2) await inputs.nth(0).fill(c.icon)
  await inputs.nth(off).fill(c.name)
  await inputs.nth(off + 1).fill(c.url)

  /*
   * ④ 的 UI 部分：favicon 模式下填完网址，弹窗要报「已获取站点图标」，
   * 而且预览框里得是**页面声明的那个地址**。
   */
  if (c.segIndex === 1) {
    const ok = await page
      .locator('.icon-status.ok')
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true)
      .catch(() => false)
    check('④a favicon 模式下弹窗报「已获取站点图标」', ok, '没等到 .icon-status.ok —— 状态反馈没生效或图标没加载成功')

    const wantPreview = c.wantStored || c.wantImg
    const previewOk = await waitPreviewSrc(wantPreview)
    const gotPreview = await previewImgSrc()
    check(
      `④b 弹窗预览 = ${c.wantStored ? '页面声明的真图标（不是猜的 /favicon.ico）' : '回落的 /favicon.ico'}`,
      previewOk,
      `实际 ${JSON.stringify(gotPreview)}`,
    )

    /*
     * ⑨ 状态字**时间线**单调 —— 2026-10-14 那个「预览假绿闪烁」的判据。
     *
     * 缺陷长这样（60ms 采样，目标 = 本站的 Pages 项目站）：
     *
     *   ~66ms  →  381ms   正在获取站点图标…  .../favicon.ico
     *   ~443ms            已获取站点图标     .../favicon.ico      ← 假绿
     *   ~507ms →  819ms   正在获取站点图标…  .../favicon.ico      ← 倒退
     *   ~945ms → 3474ms   已获取站点图标     .../jerry-skills/favicon.svg
     *
     * 根因：解析期间预览用了**猜的** `origin/favicon.ico`，它加载成功 →
     * `<img>` 的 @load 把状态置成 ok；真图标到达、src 一变又退回 loading。
     *
     * ⚠️ 单看终态（④a / ④b）**测不出**这个 —— 终态是对的，问题在中间那 64ms。
     *    所以这里必须看**序列**，不能只看最后一个值。
     */
    /*
     * ⚠️⚠️ 采样窗口必须**覆盖整轮解析**，不能一等到预览地址对上就收工。
     *
     *     这条是实测踩出来的：⑨a 一开始写成「④a ④b 过了就收 trace」，
     *     结果它是**恒真**的 —— 兜底用例里预览地址在 5313ms 就对上了
     *     （那时显示的还只是**猜的**兜底地址），而 `runResolve` 要等 450ms
     *     防抖、5730ms 才真正开跑；采样在 5313ms 就停了，倒退根本没被看到。
     *     用 `ICON_TRACE_DUMP=1` 打出时间线才看出来：
     *
     *       5232ms:muted → 5283ms:muted<favicon.ico> → 5313ms:ok<favicon.ico>   ← 采样到此为止
     *
     *     `probe-icon-source.mjs` 的造红 B（去掉 `markResolving`）就是靠这段
     *     才红的。1200ms > 450ms 防抖 + 一次本地/fulfill 的往返。
     */
    await page.waitForTimeout(1200)

    const trace = await page.evaluate(() => {
      clearInterval(window.__iconTraceTimer)
      return window.__iconTrace
    })
    // 去重成相位序列（连续同 (cls, src) 只留第一条）
    const phases = []
    for (const s of trace) {
      const k = `${s.cls}|${s.src}`
      if (phases.length && phases[phases.length - 1].k === k) continue
      phases.push({ ...s, k })
    }
    /*
     * 排查用：`ICON_TRACE_DUMP=1 npm run probe:icon-source`
     * 把完整相位时间线打出来。⑨a 红的时候**必须**看这个 ——
     * 「哪一相位倒退的」和「压根没出现过 ok」是两回事，修法完全不同。
     */
    if (process.env.ICON_TRACE_DUMP) {
      console.log(
        `    [trace] ${phases.map((p) => `${p.t}ms:${p.cls || 'muted'}${p.src ? `<${p.src.split('/').pop()}>` : ''}`).join(' → ')}`,
      )
    }
    let regression = ''
    for (let i = 1; i < phases.length; i++) {
      if (phases[i - 1].cls === 'ok' && phases[i].cls !== 'ok') {
        regression = `${phases[i - 1].t}ms 是 ok → ${phases[i].t}ms 退回 ${phases[i].cls || 'muted'}`
        break
      }
    }
    check(
      `⑨a 状态字时间线单调（没有「已获取 → 正在获取」倒退）`,
      !regression,
      regression
        ? `${regression}｜相位：${phases.map((p) => `${p.t}ms:${p.cls || 'muted'}`).join(' → ')}`
        : '',
    )

    /*
     * ⑨b 「页面**声明了**真图标」的用例里，预览 src 的历史里**一次都不该**
     *     出现猜的 `origin/favicon.ico`。
     *
     *     这条比 ⑨a 更锋利：⑨a 只要求不倒退，而「先显示错的图、再换成对的」
     *     如果中间没被采样到 ok，⑨a 是放过的 —— 但用户确实看见了那张**别人家的
     *     logo**（GitHub Pages 项目站猜出来的就是域名根的图标）。Jerry 的原话
     *     是「我要抓的是真图标，不是这个 vue 路径的图标」，所以这条要钉住。
     *
     *     ⚠️ 只对「声明地址 ≠ 猜的地址」的用例断言。兜底那条用例里
     *        `origin/favicon.ico` 本来就是**正确答案**，断言它不出现是错的。
     */
    const guess = (() => {
      try {
        return new URL(c.url).origin + '/favicon.ico'
      } catch {
        return ''
      }
    })()
    if (c.wantStored && c.wantStored !== guess) {
      const guessed = trace.filter((s) => s.src === guess)
      check(
        `⑨b 解析期间预览从未出现过猜的 /favicon.ico`,
        guessed.length === 0,
        guessed.length
          ? `出现过 ${guessed.length} 次，最早 ${guessed[0].t}ms｜src 历史：${[...new Set(trace.map((s) => s.src).filter(Boolean))].join(' , ')}`
          : '',
      )
    }
  }

  await page.locator('.modal-foot .btn-primary').click()
  await page.waitForSelector('.bm-form', { state: 'detached', timeout: 15000 })
  await page.waitForTimeout(500)

  // ② 存下来的 iconMode / icon 对不对（抓 createBookmark 逐字段构造丢字段）
  const row = await findByName(c.name)
  check(
    `② 存下来的 iconMode = ${c.wantMode}`,
    row?.iconMode === c.wantMode,
    `实际 ${JSON.stringify(row?.iconMode)}`,
  )
  check(
    `②b 存下来的 icon = ${c.wantStored === '' ? "''（空）" : c.wantStored === DATA_URL ? '填的 data URL' : '页面声明的真图标'}`,
    (row?.icon || '') === c.wantStored,
    `实际 ${JSON.stringify((row?.icon || '').slice(0, 96))}`,
  )

  // ③④c⑤⑥ 卡片按选的方式渲染
  const src = await cardImgSrc(c.name)
  check(
    `③④c⑤⑥ 卡片图标 ${c.wantImg === null ? '不渲染 <img>' : c.segIndex === 2 ? '= 填的地址' : c.wantStored ? '= 页面声明的真图标' : '= 回落的 /favicon.ico'}`,
    src === c.wantImg,
    `实际 ${src === null ? 'null（没有 <img>）' : JSON.stringify(src.slice(0, 96))}`,
  )
}

/* ------------------------------------------------------------------ */
/* ⑦ 编辑：把「自定义」切回「首字母」→ icon 要被清空                    */
/* ------------------------------------------------------------------ */

console.log('\n· 编辑 —— 自定义 → 首字母')

await page.locator('.bm-card', { hasText: 'ZZ自定义' }).locator('.bm-actions .bm-act').first().click()
await page.waitForSelector('.bm-form', { timeout: 15000 })

// 编辑弹窗里预选的应该是存下来的那个来源
const onIndex = await page.locator('.bm-form .seg-btn.on').evaluate((el) =>
  [...el.parentElement.children].indexOf(el),
)
check('⑦a 编辑时预选的来源 = 存下来的 iconMode（custom → 下标 2）', onIndex === 2, `实际下标 ${onIndex}`)

await page.locator('.bm-form .seg-btn').nth(0).click()
await page.locator('.modal-foot .btn-primary').click()
await page.waitForSelector('.bm-form', { state: 'detached', timeout: 15000 })
await page.waitForTimeout(500)

const edited = await findByName('ZZ自定义')
check('⑦b 切回首字母后 iconMode 变成 initial', edited?.iconMode === 'initial', `实际 ${JSON.stringify(edited?.iconMode)}`)
check('⑦c 切回首字母后 icon 被清空（不留旧地址）', (edited?.icon || '') === '', `实际 ${JSON.stringify((edited?.icon || '').slice(0, 96))}`)
const afterSrc = await cardImgSrc('ZZ自定义')
check('⑦d 卡片上不再有 <img>', afterSrc === null, `实际 ${JSON.stringify(afterSrc)}`)

/* ------------------------------------------------------------------ */
/* ⑧ 存量数据回填（backfillIconSrc）                                    */
/* ------------------------------------------------------------------ */

/*
 * 这一节测的是**「修好已经有书签」的那一半**。
 *
 * 上面 ①~⑦ 走的都是「新建 → 存 → 渲染」—— 只覆盖**新数据**。
 * 而 Jerry 报的那个 bug 是**已经躺在库里的**书签：它的 `icon` 是空的，
 * 卡片照旧去猜 `/favicon.ico`，于是永远显示 Vue logo。
 * 解析结果只在**弹窗保存时**才写，所以必须有一个一次性回填
 * （`useStore.backfillIconSrc()`，在 `loadAll()` 末尾不阻塞地跑）。
 *
 * ⚠️ 做法：直接往 `jt:bookmarks` 里塞几条**造好的存量数据**再刷新 ——
 *    不能靠走 UI 造，因为走 UI 造出来的必然带解析结果，测不到回填。
 *
 * ⚠️ 路由必须**开着**（这些书签的图标在 `icon.test` 上）。
 *    这一节不看 `/favicon.ico`，所以不踩坑 4。
 */
console.log('\n· ⑧ 存量数据回填')

await setRoute(true)

const BACKFILL_ROWS = [
  // 该被回填的：favicon 模式 + icon 为空
  { id: 'bm_bf_empty', name: 'ZZ回填', url: `${ICON_HOST}/declared/`, icon: '', iconMode: 'favicon' },
  // 下面三条**都不该被动** —— 回填只能补空，不能改用户的选择
  { id: 'bm_bf_initial', name: 'ZZ回填-首字母', url: `${ICON_HOST}/declared/`, icon: '', iconMode: 'initial' },
  { id: 'bm_bf_custom', name: 'ZZ回填-自定义', url: `${ICON_HOST}/declared/`, icon: DATA_URL, iconMode: 'custom' },
  { id: 'bm_bf_filled', name: 'ZZ回填-已有图标', url: `${ICON_HOST}/declared/`, icon: `${ICON_HOST}/assets/keep-me.png`, iconMode: 'favicon' },
].map((r, i) => ({
  ...r,
  categoryId: null,
  description: '',
  sortOrder: 100 + i,
  createdAt: '2026-10-14',
}))

await page.evaluate((rows) => {
  const list = JSON.parse(localStorage.getItem('jt:bookmarks') || '[]')
  const ids = new Set(rows.map((r) => r.id))
  localStorage.setItem('jt:bookmarks', JSON.stringify([...list.filter((b) => !ids.has(b.id)), ...rows]))
}, BACKFILL_ROWS)

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bm-card', { timeout: 25000 })

const filledOk = await waitCardImgSrc('ZZ回填', DECLARED_ICON)
const filledRow = await findByName('ZZ回填')
check('⑧a 回填：favicon 模式 + icon 为空 → 卡片显示页面声明的真图标', filledOk, `卡片实际 ${JSON.stringify(await cardImgSrc('ZZ回填'))}`)
check(
  '⑧b 回填结果**写进了存储**（下次打开不用重算）',
  filledRow?.icon === DECLARED_ICON,
  `实际 ${JSON.stringify((filledRow?.icon || '').slice(0, 96))}`,
)

const bfInitial = await findByName('ZZ回填-首字母')
const bfCustom = await findByName('ZZ回填-自定义')
const bfFilled = await findByName('ZZ回填-已有图标')
check('⑧c 回填**不动** initial 模式（icon 仍是空）', (bfInitial?.icon || '') === '', `实际 ${JSON.stringify(bfInitial?.icon)}`)
check('⑧d 回填**不动** custom 模式（icon 仍是用户填的）', bfCustom?.icon === DATA_URL, `实际 ${JSON.stringify((bfCustom?.icon || '').slice(0, 48))}`)
check(
  '⑧e 回填**不覆盖**已有图标',
  bfFilled?.icon === `${ICON_HOST}/assets/keep-me.png`,
  `实际 ${JSON.stringify(bfFilled?.icon)}`,
)

/* ------------------------------------------------------------------ */

await browser.close()
srv.close()

console.log(`\n通过 ${pass} / 失败 ${fail}`)
process.exit(fail ? 1 : 0)
