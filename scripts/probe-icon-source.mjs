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
     ② 每种来源选完 → 存下来的 `iconMode` 就是它（**抓 createBookmark 丢字段**）
     ③ initial → 卡片上**没有** <img>（只剩字母块）
     ④ favicon → 卡片 <img> 指向站点自己的 /favicon.ico，且弹窗报「已获取站点图标」
     ⑤ custom  → 卡片 <img> 指向填的那个地址
     ⑥ 编辑时切回 initial → `icon` 被**清空**（不留旧地址在数据里）

   ══ ⚠️ 两个必须知道的坑（都是实测踩出来的）════════════════════════

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
     所以下面起了个自带的极小服务（`startIconServer()`），
     而不是用 `page.route()` 伪造。用假域名（`favicon.example`）更不行：
     解析不了的域名在渲染层就被拒，连 REQ 事件都没有。

   【坑 2】`BookmarkIcon.vue` 在 <img> onerror 时会把图片**从 DOM 移除**
     （`showImage = !!src && !failed`）。所以只要图标加载失败，
     ③④⑤ 全都会退化成「没有图」—— 三种来源**分不出来**，断言恒真。
     喂得到真图（坑 1 的服务）是这个脚本有意义的前提。

   ── 自定义图标为什么用 data URL ──────────────────────────────────

     `isUsableIcon()` 只放行 **https**（和站内路径 / data:）。
     本机服务是 http，拿它当自定义图标地址会被判为不合格 → 回落站点图标，
     断言就测不到 custom 分支了。data URL 走的是同一条「合格地址」路径，
     又不需要证书，最省事。

   用法：node scripts/probe-icon-source.mjs [base]
        默认 http://127.0.0.1:5200/jerry-tools/（先 npm run build && npm run serve:dist）
   ========================================================================= */

import { createServer } from 'node:http'
import pw from './lib/playwright.mjs'

const { chromium } = pw
const BASE = process.argv[2] || 'http://127.0.0.1:5200/jerry-tools/'

/** 1×1 透明 PNG。既是 favicon 服务的响应体，也是自定义图标的 data URL 载荷。 */
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
/* 自带的「站点」：只为提供真实的 /favicon.ico（见文件头【坑 1】）      */
/* ------------------------------------------------------------------ */

function startIconServer() {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      // 所有路径都返回同一张图 —— 我们只关心「那个 origin 有 favicon.ico」
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' })
      res.end(PNG)
    })
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }))
  })
}

const { srv, port } = await startIconServer()
const SITE = `http://127.0.0.1:${port}/`

/**
 * 三个用例。
 *
 * `segIndex` 就是弹窗里 `.seg-btn` 的下标 —— 与
 * `BookmarkDialog.vue` 的 `ICON_MODE_OPTIONS` 顺序（首字母 / 网站图标 / 自定义）
 * 一一对应。改那个数组的顺序就要改这里（探针会当场红，不会静默错位）。
 */
const CASES = [
  {
    segIndex: 0,
    id: 'initial',
    name: 'ZZ首字母',
    url: SITE + 'initial-page',
    icon: '',
    wantMode: 'initial',
    wantImg: null, // null = 卡片上不该有 <img>
  },
  {
    segIndex: 1,
    id: 'favicon',
    name: 'ZZ网站图标',
    url: SITE + 'favicon-page',
    icon: '',
    wantMode: 'favicon',
    // faviconOf() 取的是 origin，所以不管 url 带什么路径，都是这个地址
    wantImg: `http://127.0.0.1:${port}/favicon.ico`,
  },
  {
    segIndex: 2,
    id: 'custom',
    name: 'ZZ自定义',
    url: SITE + 'custom-page',
    icon: DATA_URL,
    wantMode: 'custom',
    wantImg: DATA_URL,
  },
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })

console.log(`\n基线：${BASE}\n自带站点：${SITE}\n`)

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

/* ------------------------------------------------------------------ */
/* 逐种来源走一遍                                                      */
/* ------------------------------------------------------------------ */

for (const c of CASES) {
  console.log(`\n· ${c.id} —— ${c.name}`)

  await page.locator('.tb-right .tb-btn').nth(1).click()
  await page.waitForSelector('.bm-form', { timeout: 15000 })

  const segs = page.locator('.bm-form .seg-btn')
  const segCount = await segs.count()
  check('① 弹窗里有 3 个来源选项', segCount === 3, `拿到 ${segCount} 个`)

  await segs.nth(c.segIndex).click()

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

  // ④ 的 UI 部分：favicon 模式下填完网址，弹窗要报「已获取站点图标」
  if (c.segIndex === 1) {
    const ok = await page
      .locator('.icon-status.ok')
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true)
      .catch(() => false)
    check('④a favicon 模式下弹窗报「已获取站点图标」', ok, '没等到 .icon-status.ok —— 状态反馈没生效或图标没加载成功')
  }

  await page.locator('.modal-foot .btn-primary').click()
  await page.waitForSelector('.bm-form', { state: 'detached', timeout: 15000 })
  await page.waitForTimeout(500)

  // ② 存下来的 iconMode 对不对（抓 createBookmark 逐字段构造丢字段）
  const row = await findByName(c.name)
  check(
    `② 存下来的 iconMode = ${c.wantMode}`,
    row?.iconMode === c.wantMode,
    `实际 ${JSON.stringify(row?.iconMode)}（整条 ${row ? JSON.stringify({ icon: (row.icon || '').slice(0, 24), iconMode: row.iconMode }) : '没找到'}）`,
  )
  if (c.segIndex === 2) {
    check('②b 自定义模式下 icon 也存下来了', row?.icon === c.icon, `实际 ${JSON.stringify((row?.icon || '').slice(0, 24))}`)
  } else {
    check('②b 非自定义模式下 icon 被清空', (row?.icon || '') === '', `实际 ${JSON.stringify(row?.icon)}`)
  }

  // ③④b⑤ 卡片按选的方式渲染
  const src = await cardImgSrc(c.name)
  check(
    `③④b⑤ 卡片图标 ${c.wantImg === null ? '不渲染 <img>' : c.segIndex === 2 ? '= 填的地址' : `= ${c.wantImg}`}`,
    src === c.wantImg,
    `实际 ${src === null ? 'null（没有 <img>）' : JSON.stringify(src.slice(0, 80))}`,
  )
}

/* ------------------------------------------------------------------ */
/* ⑥ 编辑：把「自定义」切回「首字母」→ icon 要被清空                    */
/* ------------------------------------------------------------------ */

console.log('\n· 编辑 —— 自定义 → 首字母')

await page.locator('.bm-card', { hasText: 'ZZ自定义' }).locator('.bm-actions .bm-act').first().click()
await page.waitForSelector('.bm-form', { timeout: 15000 })

// 编辑弹窗里预选的应该是存下来的那个来源
const onIndex = await page.locator('.bm-form .seg-btn.on').evaluate((el) =>
  [...el.parentElement.children].indexOf(el),
)
check('⑥a 编辑时预选的来源 = 存下来的 iconMode（custom → 下标 2）', onIndex === 2, `实际下标 ${onIndex}`)

await page.locator('.bm-form .seg-btn').nth(0).click()
await page.locator('.modal-foot .btn-primary').click()
await page.waitForSelector('.bm-form', { state: 'detached', timeout: 15000 })
await page.waitForTimeout(500)

const edited = await findByName('ZZ自定义')
check('⑥b 切回首字母后 iconMode 变成 initial', edited?.iconMode === 'initial', `实际 ${JSON.stringify(edited?.iconMode)}`)
check('⑥c 切回首字母后 icon 被清空（不留旧地址）', (edited?.icon || '') === '', `实际 ${JSON.stringify((edited?.icon || '').slice(0, 24))}`)
const afterSrc = await cardImgSrc('ZZ自定义')
check('⑥d 卡片上不再有 <img>', afterSrc === null, `实际 ${JSON.stringify(afterSrc)}`)

/* ------------------------------------------------------------------ */

await browser.close()
srv.close()

console.log(`\n通过 ${pass} / 失败 ${fail}`)
process.exit(fail ? 1 : 0)
