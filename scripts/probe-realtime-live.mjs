/* =========================================================================
   probe-realtime-live.mjs —— 云同步「到底有没有在工作」的**唯一可靠**判据

   为什么需要它（2026-10-26）：

     `useRealtime.js` 的文件头第一条就写着：

       「订阅状态不等于「能收到事件」。`subscribe()` 返回 `SUBSCRIBED`
         只说明 websocket 连上了……唯一可靠的判据是「写一行 → 看有没有事件」。」

     然后这半年里**没有任何一个脚本做过这件事**。也就是说这条判据
     只存在于注释里 —— 谁也不知道线上到底通不通。

     而它的失败模式恰恰是最坏的那种：**全静默**。
     表没进 `supabase_realtime` 发布 → 状态照样绿 → 界面显示「同步中」，
     实际一条事件都收不到。用户只会觉得「怎么另一台改了这边没变」，
     然后归因成「这功能本来就不好使」。

   本脚本做的事（两个独立浏览器上下文，同一个账号）：

     ① 两边都登录 → 断言顶栏 `.sync-dot` 变 `live`（不是一直 `connecting`）
     ② **绕过 UI，直接用 REST 插一行 `bookmarks`** —— 这是「另一台设备」的替身
     ③ 断言 B 页面**不刷新**就长出了这张卡片（← 这一条就是全部意义所在）
     ④ REST 删掉那行 → 断言 B 的卡片消失（DELETE 事件最容易漏，见下）
     ⑤ A 那边不该出现**两张**同名卡片（自己那份 + 回声推回来那份）

   ⚠️ 为什么用 REST 而不是点 UI 写入：
      点 UI 会连带触发 `persist()` → 整表 diff → 一堆网络请求，
      其中任何一环慢/失败都会让「卡片没出现」变得无法归因。
      REST 插入只有一个变量：**事件有没有推过来**。
      「自己写的东西被原样回推」那部分（回声抑制）是纯逻辑，
      归 `probe-realtime-patch.mjs`，不该在这里验。

   ⚠️ 为什么 ④ 单列一节：
      postgres_changes 的 DELETE 事件里 `old_record` **默认只带主键列**，
      而客户端的 `filter` 必须落在主键上才能匹配。配错的表现是
      「改了能同步、删了不同步」—— 只测 INSERT 永远发现不了。

   前置（要一个带真实 Supabase 配置的构建）：
     npm run build
     npm run serve:dist            # 5200，base /jerry-tools/
     node scripts/probe-realtime-live.mjs

   用法：node scripts/probe-realtime-live.mjs [baseUrl]
   ========================================================================= */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pw, { ROOT } from './lib/playwright.mjs'

const BASE = process.argv[2] || 'http://127.0.0.1:5200/jerry-tools/'
const PROBE_EMAIL = process.env.PROBE_EMAIL || 'jt-transfer-probe@jerry.tools'
const PROBE_PASSWORD = process.env.PROBE_PASSWORD || 'Pw-transfer-Aa1'

/* 这行的名字要**足够独特**，否则分不清是种子数据还是探针插的 */
const PROBE_NAME = `RT-PROBE-${Date.now().toString(36).toUpperCase()}`
const PROBE_ID = `rtprobe_${Date.now().toString(36)}`

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
 * Playwright 的 Chromium 不继承系统代理，也不读 `http_proxy`。
 * localhost 必须 bypass，否则连本地静态服务也绕出去。
 */
const proxyOpt = process.env.NO_PROXY_BROWSER
  ? {}
  : { proxy: { server: 'http://127.0.0.1:7897', bypass: '127.0.0.1,localhost' } }

/* ------------------------------------------------------ 从 .env.local 取配置
 * 页面里读不到 supabase 配置（没有挂到 window 上，也不该挂）。
 * 但探针要发 REST 请求，所以直接读构建用的那份 .env.local。
 */
function readEnv() {
  const out = {}
  for (const f of ['.env.local', '.env']) {
    let txt
    try {
      txt = readFileSync(join(ROOT, f), 'utf8')
    } catch {
      continue
    }
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m && !(m[1] in out)) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
  return out
}

async function waitAppReady(page, timeout = 40000) {
  // ⚠️ 不能只等「#app 非空」—— index.html 的首屏占位也在 #app 里
  await page.waitForFunction(
    () => !!document.querySelector('#app > *:not(.boot-splash)'),
    null,
    { timeout },
  )
}

/**
 * 登录。返回是否成功（失败不算异常，让调用方决定怎么记）。
 *
 * ⚠️ **必须带重试**：实测第一台设备经常第一次登不上（走代理时首个
 *    Supabase 请求要冷启动 TLS，30 秒都能耗光），第二台反而一次就过。
 *    不重试的话探针会随机红一条，看起来像同步坏了，实际只是登录慢。
 */
async function login(ctx, attempts = 3) {
  const page = await ctx.newPage()
  let lastWhy = ''

  for (let i = 0; i < attempts; i++) {
    await page.goto(new URL('login', BASE).href, { waitUntil: 'domcontentloaded' })
    await waitAppReady(page)
    await sleep(1500)

    const inputs = page.locator('input')
    if ((await inputs.count()) < 2) {
      lastWhy = '登录表单没出现'
      continue
    }
    await inputs.nth(0).fill(PROBE_EMAIL)
    const pwd = page.locator('input[type="password"]').first()
    await pwd.fill(PROBE_PASSWORD)
    await pwd.press('Enter')

    const ok = await page
      .waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 45000 })
      .then(() => true)
      .catch(() => false)

    if (ok) {
      await page.goto(BASE, { waitUntil: 'domcontentloaded' })
      await waitAppReady(page)
      await page.waitForSelector('.bm-card, .bm-empty, .empty', { timeout: 30000 }).catch(() => {})
      await sleep(1500)
      return { page, ok: true }
    }

    // 把页面上的报错原文捞出来 —— 「登录失败」四个字对排查毫无用处
    lastWhy = await page
      .evaluate(() => {
        const e = document.querySelector('.err')
        return e ? e.textContent.trim() : ''
      })
      .catch(() => '')
    lastWhy = `第 ${i + 1} 次停在 ${page.url()}${lastWhy ? ' · 页面报错：' + lastWhy : ''}`
    console.log(`     ⚠️ ${lastWhy}，重试`)
    await sleep(3000)
  }

  return { page, ok: false, why: lastWhy }
}

/** 等顶栏那个同步指示灯变成某个状态。 */
function waitSyncDot(page, want, timeout = 25000) {
  return page
    .waitForFunction(
      (w) => {
        const d = document.querySelector('.sync-dot')
        return !!d && d.classList.contains(w)
      },
      want,
      { timeout },
    )
    .then(() => true)
    .catch(() => false)
}

const syncDotState = (page) =>
  page.evaluate(() => {
    const d = document.querySelector('.sync-dot')
    if (!d) return '(没有 .sync-dot)'
    return ['live', 'connecting', 'error', 'off'].find((c) => d.classList.contains(c)) || d.className
  })

/** 页面上出现几张名字正好是 name 的卡片。 */
const countCards = (page, name) =>
  page.evaluate(
    (n) =>
      [...document.querySelectorAll('.bm-card .bm-name')].filter(
        (e) => e.textContent.trim() === n,
      ).length,
    name,
  )

async function waitCards(page, name, want, timeout = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if ((await countCards(page, name)) === want) return { ok: true, ms: Date.now() - t0 }
    await sleep(250)
  }
  return { ok: false, ms: Date.now() - t0, got: await countCards(page, name) }
}

/* ------------------------------------------------------------- REST 直写 */
async function rest(page, { url, key, token, method, path, body }) {
  return page.evaluate(
    async ({ url, key, token, method, path, body }) => {
      const r = await fetch(`${url}/rest/v1/${path}`, {
        method,
        headers: {
          apikey: key,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: body ? JSON.stringify(body) : undefined,
      })
      const text = await r.text()
      return { status: r.status, text: text.slice(0, 400) }
    },
    { url, key, token, method, path, body },
  )
}

/* ================================================================== 主流程 */

const cfg = readEnv()
const SB_URL = cfg.VITE_SUPABASE_URL || ''
const SB_KEY = cfg.VITE_SUPABASE_ANON_KEY || ''

if (!SB_URL || !SB_KEY) {
  console.log('⏭️  .env.local 里没有 Supabase 配置 —— 这个探针只对云端构建有意义，跳过。')
  process.exit(0)
}

const browser = await pw.chromium.launch({ headless: true, ...proxyOpt })
let pageA = null
let pageB = null
let token = null
let uid = null
let inserted = false

try {
  section('① 两个独立上下文登录同一个账号，两边都该进 live')

  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 1000 } })

  /**
   * 接管 B 的 realtime websocket —— ⑤ 要靠它制造**真断线**。
   *
   * ⚠️ 必须在登录**之前**装：`routeWebSocket` 只管**之后**新建的连接，
   *    先连上的那条它抓不到，也就没法掐。
   *
   * 为什么不用 `context.setOffline(true)`：那是**网络层模拟**，
   *    它不掐已建立的 websocket，服务端发来的帧只是堆在缓冲区里，
   *    网络恢复时**原样补发**。实测：断网 20 秒、期间插一行，
   *    指示灯全程 `live`、也没有任何 `[realtime]` 日志，恢复后那行
   *    直接出现 —— 看起来「同步很棒」，其实是浏览器在替我们兜底，
   *    真实断网（服务端早就把连接丢了）根本不会这样。
   *    拿它验「断线补偿」等于验了个假的。
   */
  let wsMode = 'pass'
  let liveWs = null
  await ctxB.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    if (wsMode === 'block') {
      // 模拟「连不上」：直接掐掉，服务端根本没参与
      ws.close()
      return
    }
    liveWs = ws
    ws.connectToServer()
  })

  const a = await login(ctxA)
  const b = await login(ctxB)
  pageA = a.page
  pageB = b.page

  /**
   * 把两边的 `[realtime]` 日志全收下来。
   *
   * 这一层是**必需的**，不是为了好看：这个模块的失败模式全是静默的，
   * 而它自己把关键转折（`全量重读（重连）` / `重新订阅（退避重连）` /
   * `重连次数用尽`）都打在 console 里。不抓日志的话，探针红了只能说
   * 「指示灯不对」，说不出是哪一步没发生。
   */
  const logs = { A: [], B: [] }
  for (const [tag, pg] of [
    ['A', pageA],
    ['B', pageB],
  ]) {
    pg.on('console', (m) => {
      const t = m.text()
      if (/\[realtime\]/.test(t)) logs[tag].push(t)
    })
  }
  const dumpLogs = (tag, from = 0) => {
    const list = logs[tag].slice(from)
    if (!list.length) return `     （${tag} 没有任何 [realtime] 日志）`
    return list.map((l) => `     ${tag} │ ${l}`).join('\n')
  }

  check('A 登录成功', a.ok, a.why || '')
  check('B 登录成功', b.ok, b.why || '')
  if (!a.ok || !b.ok) throw new Error('登录失败，后面的都验不了')

  const liveA = await waitSyncDot(pageA, 'live')
  const liveB = await waitSyncDot(pageB, 'live')
  check('A 的同步指示灯变 live', liveA, `实际 ${await syncDotState(pageA)}`)
  check('B 的同步指示灯变 live', liveB, `实际 ${await syncDotState(pageB)}`)

  /**
   * ⚠️ 只看一眼 `live` 不够 —— `onSystem` 那条服务端拒绝是**后到**的：
   *    先 SUBSCRIBED（翻绿），再报 not_enabled。所以得等一会儿再看，
   *    否则探针会替一个「假绿」背书。
   */
  await sleep(2500)
  const stillA = await syncDotState(pageA)
  const stillB = await syncDotState(pageB)
  check('2.5 秒后 A 仍是 live（没被后到的 system 错误翻掉）', stillA === 'live', `实际 ${stillA}`)
  check('2.5 秒后 B 仍是 live（没被后到的 system 错误翻掉）', stillB === 'live', `实际 ${stillB}`)

  /* 取 token —— 用来以「另一台设备」的身份直接写库 */
  const auth = await pageA.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('jt:auth') || 'null')
    } catch {
      return null
    }
  })
  token = auth?.access_token
  uid = auth?.user?.id
  check('拿到了 access_token / uid', !!token && !!uid, token ? '' : 'jt:auth 里没有 access_token')

  if (!token || !uid) throw new Error('没有 token，无法模拟另一台设备')

  /* ---------------------------------------------------------------- ②③ */
  section('②③ 从「另一台设备」插入一行 → B 不刷新就该长出来')

  const beforeB = await countCards(pageB, PROBE_NAME)
  check('插入前 B 页面上没有这张卡片（基线）', beforeB === 0, `已经有 ${beforeB} 张`)

  const ins = await rest(pageA, {
    url: SB_URL,
    key: SB_KEY,
    token,
    method: 'POST',
    path: 'bookmarks',
    body: [
      {
        id: PROBE_ID,
        user_id: uid,
        category_id: null,
        name: PROBE_NAME,
        url: `https://rt-probe.example/${PROBE_ID}`,
        description: '',
        icon: '',
        icon_mode: 'favicon',
        sort_order: 0,
      },
    ],
  })
  inserted = ins.status >= 200 && ins.status < 300
  check('REST 插入成功', inserted, `HTTP ${ins.status} ${ins.text}`)

  if (inserted) {
    const got = await waitCards(pageB, PROBE_NAME, 1)
    check(
      '🔴 B 页面**不刷新**就出现了这张卡片（= 事件真的推过来了）',
      got.ok,
      got.ok ? `${got.ms}ms` : `${got.ms}ms 内仍是 ${got.got} 张`,
    )

    // 自己这台（A）也收到了同一行的广播，但**不该**出现两张
    const gotA = await waitCards(pageA, PROBE_NAME, 1)
    check('A 页面上恰好 1 张，没有出现重复（id 认人正确）', gotA.ok, `实际 ${gotA.got} 张`)

    /* ---------------------------------------------------------------- ④ */
    section('④ 删掉那行 → B 的卡片该消失（DELETE 事件单独验）')

    const del = await rest(pageA, {
      url: SB_URL,
      key: SB_KEY,
      token,
      method: 'DELETE',
      path: `bookmarks?id=eq.${encodeURIComponent(PROBE_ID)}`,
    })
    const deleted = del.status >= 200 && del.status < 300
    check('REST 删除成功', deleted, `HTTP ${del.status} ${del.text}`)
    if (deleted) inserted = false

    if (deleted) {
      const gone = await waitCards(pageB, PROBE_NAME, 0)
      check(
        '🔴 B 页面**不刷新**卡片就消失了（= DELETE 事件没被静默丢掉）',
        gone.ok,
        gone.ok ? `${gone.ms}ms` : `${gone.ms}ms 内仍有 ${gone.got} 张`,
      )
      const goneA = await waitCards(pageA, PROBE_NAME, 0)
      check('A 页面也同步删掉了', goneA.ok, goneA.ok ? `${goneA.ms}ms` : `仍有 ${goneA.got} 张`)
    }
  }

  /* ------------------------------------------------------------------ ⑤ */
  section('⑤ 断线期间发生的事，重连后必须靠全量重读补回来')

  /**
   * 这是 `useRealtime.js` 第三条设计约束的直接验证，也是最容易「看着好了其实废了」的一条：
   *
   *   postgres_changes **没有回放**。B 断网那段时间别人改的东西，
   *   事件永远不会再来一次。如果重连后不做 `reloadStore()`，
   *   B 会一直显示一份过期的数据，而且指示灯是**绿的**。
   *
   * 做法（真断线，不是网络层模拟 —— 理由见上面 routeWebSocket 那段）：
   *   ① 掐掉 B 的 websocket，并让后续重连**一律失败**（`wsMode='block'`）
   *   ② 断言指示灯转 `error`（这条同时验证了 CLOSED 事件有没有被接住）
   *   ③ A 插一行 —— B 这条路上根本没有连接，事件**确定收不到**
   *   ④ 放行重连 → 该回 `live`，并且**靠全量重读**把那一行捞出来
   *
   * ⚠️ 判据不能只看「卡片出现了」—— 必须同时看到
   *    `全量重读（重连）` 这行日志，否则可能是别的原因碰巧补上的。
   */
  const MISSED_NAME = `${PROBE_NAME}-MISSED`
  const MISSED_ID = `${PROBE_ID}_m`
  const logMark = logs.B.length

  // 先确保基线干净
  await waitCards(pageB, MISSED_NAME, 0, 3000)

  check('已经抓到 B 的实时连接（否则后面掐不断）', !!liveWs)

  wsMode = 'block'
  liveWs?.close()

  const wentError = await waitSyncDot(pageB, 'error', 20000)
  check('B 断线后指示灯变 error（不是继续装绿）', wentError, `实际 ${await syncDotState(pageB)}`)

  const ins2 = await rest(pageA, {
    url: SB_URL,
    key: SB_KEY,
    token,
    method: 'POST',
    path: 'bookmarks',
    body: [
      {
        id: MISSED_ID,
        user_id: uid,
        category_id: null,
        name: MISSED_NAME,
        url: `https://rt-probe.example/${MISSED_ID}`,
        description: '',
        icon: '',
        icon_mode: 'favicon',
        sort_order: 0,
      },
    ],
  })
  const inserted2 = ins2.status >= 200 && ins2.status < 300
  check('B 断网期间，A 成功插入一行（B 必然收不到这条事件）', inserted2, `HTTP ${ins2.status} ${ins2.text}`)

  if (inserted2) {
    // 断线时 B 页面上不该有 —— 这一步是「事件确实没到」的反证
    await sleep(1500)
    const whileOffline = await countCards(pageB, MISSED_NAME)
    check('断线时 B 页面上确实没有它（确认事件真的没到）', whileOffline === 0, `${whileOffline} 张`)

    // 放行重连
    wsMode = 'pass'
    const backLive = await waitSyncDot(pageB, 'live', 45000)
    check('B 放行重连后回到 live', backLive, `实际 ${await syncDotState(pageB)}`)

    const recovered = await waitCards(pageB, MISSED_NAME, 1, 30000)
    check(
      '🔴 断线期间漏掉的那行，重连后补上了',
      recovered.ok,
      recovered.ok ? `${recovered.ms}ms` : `30s 内仍是 ${recovered.got} 张`,
    )

    console.log('\n     —— B 这边这段期间的 [realtime] 日志 ——')
    console.log(dumpLogs('B', logMark))

    /**
     * ⚠️ 这条才是「补上了」的**因果证据**。
     *    卡片出现只能说明结果对了，说明不了是哪条路径补的。
     *    必须看到 `全量重读（重连）`，才证明走的是「重连 → reloadStore」，
     *    而不是「事件其实到了」或者「别的东西碰巧刷新了列表」。
     */
    const sawResync = logs.B.slice(logMark).some((l) => l.includes('全量重读'))
    check('日志里出现了「全量重读」—— 证明是重连补偿，不是事件碰巧到了', sawResync)

    // 收尾
    await rest(pageA, {
      url: SB_URL,
      key: SB_KEY,
      token,
      method: 'DELETE',
      path: `bookmarks?id=eq.${encodeURIComponent(MISSED_ID)}`,
    }).catch(() => null)
  }

  /* ------------------------------------------------------------------ ⑥ */
  section('⑥ 长时间断线（> 退避上限）之后，网络回来了能不能自己爬起来')

  /**
   * 这一节是**故意的长跑**，跑一次两分多钟。它盯的是一个很具体的场景：
   *
   *   笔记本合盖 / 通勤进隧道 / 家里宽带掉线两三分钟 —— 用户的页面**一直开着**，
   *   既没刷新也没切标签。网络回来了，界面上的灯是不是能自己变回绿色？
   *
   * 代码里的现状是 `MAX_RETRY = 6`，退避 1+2+4+8+16+30 ≈ 61 秒后
   * **我们这层**不再主动重建 channel。
   *
   * ⚠️ 我一开始的假设是「放弃之后就永久死了，只能刷新页面」——**实测是错的**：
   *    放弃之后紧跟着一条 `全量重读（重连）`，救回来的是 supabase-js
   *    自己的重连（客户端内部一直按自己的退避在重连 socket）。所以这层退避
   *    只是**叠加**在库自带之上，不是唯一命脉。这一节留着是为了钉住这个事实，
   *    免得以后有人照着「放弃 = 死了」去改代码。
   *
   * 判据：把 ws 关掉并让重连一直失败，等到日志里出现「自己不再重建」；
   *      然后**放行**网络，看它会不会自己回来。
   */
  const logMark6 = logs.B.length

  wsMode = 'block'
  liveWs?.close()

  // 等「自己不再重建」那一刻（退避累计约 61 秒，留足余量）
  const gaveUp = await (async () => {
    const t0 = Date.now()
    while (Date.now() - t0 < 100000) {
      if (logs.B.slice(logMark6).some((l) => l.includes('自己不再重建'))) return true
      await sleep(1000)
    }
    return false
  })()
  check('长时间断线后触发了退避上限（我们这层不再重建）', gaveUp, '100 秒内没等到')

  const dotAfterGiveUp = await syncDotState(pageB)
  check('此时指示灯是 error', dotAfterGiveUp === 'error', `实际 ${dotAfterGiveUp}`)

  // 网络恢复
  wsMode = 'pass'
  const cameBack = await waitSyncDot(pageB, 'live', 45000)
  check(
    '🔴 网络恢复后**不需要刷新页面**就能自己回到 live',
    cameBack,
    cameBack ? '' : `45 秒后仍是 ${await syncDotState(pageB)}`,
  )

  /**
   * 日志**无条件**打出来。这一节的意义有一半在这里：
   * 如果恢复路径里没有 `重新订阅（退避重连）`，说明救回来的不是我们这层，
   * 而是 supabase-js 自己的重连 —— 那 `MAX_RETRY` 这个「放弃」其实没那么致命，
   * 别照着错的结论去改代码。
   */
  console.log('\n     —— B 这边这段期间的 [realtime] 日志 ——')
  console.log(dumpLogs('B', logMark6))
  const ourRebuild = logs.B.slice(logMark6).filter((l) => l.includes('重新订阅')).length
  console.log(`     （其中我们这层发起的重新订阅：${ourRebuild} 次）`)
} catch (e) {
  console.log(`\n💥 ${e.message}`)
  fail++
  failures.push(e.message)
} finally {
  /**
   * 收尾：不管走到哪一步，库里都不能留下探针的行。
   * ⚠️ 两行都要清 —— ⑤ 那行是在中途插的，`inserted` 这个标记管不到它。
   */
  if (pageA && token) {
    for (const id of [PROBE_ID, `${PROBE_ID}_m`]) {
      const del = await rest(pageA, {
        url: SB_URL,
        key: SB_KEY,
        token,
        method: 'DELETE',
        path: `bookmarks?id=eq.${encodeURIComponent(id)}`,
      }).catch(() => null)
      if (!del || del.status >= 300) {
        console.log(`\n🧹 收尾删除 ${id} 失败（手动清一下）`)
      }
    }
    console.log('\n🧹 收尾清理完成')
  }
  await browser.close()
}

console.log(`\n${'='.repeat(60)}`)
console.log(`通过 ${pass} / 失败 ${fail}`)
if (fail) {
  console.log('失败项：')
  for (const f of failures) console.log('  · ' + f)
}
process.exit(fail ? 1 : 0)
