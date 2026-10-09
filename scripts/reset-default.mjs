/* =========================================================================
   「恢复默认」到底动了什么 + 默认配置（种子）是否完整

   📌 来源：这个文件 2026-10-09 从**会话记录**里回放恢复
      （`scripts/recover-from-transcript.mjs`）。它原本住在 `/tmp/jerry-sb/`，
      被系统按文件清理掉了。恢复出来 24,193 B / 513 行，
      只改了三处「只在原机成立」的依赖：playwright 绝对路径、种子绝对路径、
      默认端口 5199 → 5200。恢复后复跑 **45 / 0**，与当初记录的条数一致。

   起因（Jerry 2026-09-29 的原话）：
     「Jerry 导航的恢复默认将原本的数据都清除了，帮我在默认书签和分类中
       有一个默认配置，并添加这个书签：https://tools.pdf24.org/zh/」

   这条反馈里有**两个可以分开验证的命题**，探针分别量：

     A. 诊断：「恢复默认」真的会清掉书签/分类吗？
        读代码得到的结论是**不会** —— `resetSettings()` 只调
        `setSettings({ ...defaultSettings })`，落盘的是 `jt:settings` 一个键。
        但「读代码」不足以定论，所以场景 1 / 2 直接点它，量前后差异。
        真实的界面问题在**摆放**：「恢复默认」紧挨在「确认清除」分组下面、
        自己不带分组标题，读起来像第三个「清除」动作。

     B. 验收：默认配置（种子）必须完整，且**清空之后有路回到默认**。
        这是真缺口 —— `seedIfEmpty()` 的判据是「键不存在 + 从没灌过种子」，
        所以 `seedVersion` 一落盘，用户清空后**永远回不到默认数据**
        （这是 2026-09-27 那轮故意改成这样的，见 read-fail-audit.mjs）。
        场景 3 先把「没有路」这个前提钉住，场景 4 验收新加的「恢复默认数据」。

   用法：node scripts/reset-default.mjs [base]   （npm run probe:reset 会带上它）

   ⚠️ 期望值**从 `src/data/seed.js` 直接 import**，不写死条数 ——
      这样加书签不用改探针。但**两条新链接是硬编码的验收标准**
      （用户点名要的），它们才是修复前应当报红的那两条。

   ⚠️ 造红：把 `useStore.js` 的 `resetToDefaults()` 改成 `return false`
      （或在 SettingsPanel 里让按钮的 click 直接 return）。

      🔴 实测（2026-10-09 重跑确认）：**34 / 11**，红的是**场景 4 的 9 条 + 场景 6 的 2 条**。
      场景 0 / 0b / 1 / 2 / 3 / 5 / 7 照常绿。

      ⚠️ 原文写的是「场景 6 照常绿」—— **那条预期是错的**。
      场景 6 是「A 标签页恢复默认 → B 标签页的内存态跟上」，
      它**依赖** `resetToDefaults()` 真干活；函数直接 return 的话 A 根本没恢复，
      B 自然跟不上 → 那两条必须红。留着原文会让人以为探针坏了。
   ========================================================================= */

import pw from './lib/playwright.mjs'   // ← 可移植解析，别再写死绝对路径
import { seedBookmarks, seedCategories } from '../src/data/seed.js'

const BASE = process.argv[2] || 'http://127.0.0.1:5200/jerry-tools/'   // 对齐 npm run serve:dist
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
    console.log(`  ❌ ${name}${detail ? `  → ${detail}` : ''}`)
  }
}

/** 用户点名要的两条链接 —— 硬编码的验收标准，别改成从种子里推导。 */
const WANT = [
  { key: 'ai-study-exam.onrender.com', label: 'Agent Lab（学习工作台）' },
  { key: 'tools.pdf24.org', label: 'PDF24 Tools' },
]

const SEED_CAT_N = seedCategories.length
const SEED_BM_N = seedBookmarks.length

/* ---------------------------------------------------------------- 夹具 */

const CATS = [
  { id: 'cat_a', name: '甲分类', icon: 'Code2', parentId: null, sortOrder: 0 },
  { id: 'cat_b', name: '乙分类', icon: 'Palette', parentId: null, sortOrder: 1 },
]
const bm = (id, name, categoryId, sortOrder) => ({
  id, name, categoryId, url: `https://${id}.example.com`,
  description: '', icon: '', sortOrder,
})
const BMS = [bm('k1', '甲一', 'cat_a', 0), bm('k2', '甲二', 'cat_a', 1), bm('k3', '乙一', 'cat_b', 0)]

/** 夹具设置：故意与默认值不同，用来验「恢复默认」的真实职责。 */
const SETTINGS = {
  themeMode: 'Dark', accent: 'teal', layout: 'grid', cardStyle: 'default', density: 'normal',
  perRow: 3, displayScope: 'full', showFavoritesUnderSearch: false, showBookmarkTooltip: true,
  editMode: true, searchEngine: 'google', language: 'zh', iconScheme: 'slate-mist',
  iconGradient: 'vivid', weatherAnimation: false, weatherCity: '北京', useGeolocation: false,
}

/* ------------------------------------------------------- 页面观察 / 工具 */

const snap = (page) =>
  page.evaluate(() => {
    const j = (k) => {
      try {
        return JSON.parse(localStorage.getItem(k) || 'null')
      } catch {
        return null
      }
    }
    const bms = j('jt:bookmarks') || []
    const cats = j('jt:categories') || []
    const st = j('jt:settings') || {}
    return {
      bmIds: bms.map((b) => b.id),
      bmNames: bms.map((b) => b.name),
      bmUrls: bms.map((b) => b.url),
      catIds: cats.map((c) => c.id),
      cards: document.querySelectorAll('.bm-card').length,
      cardNames: [...document.querySelectorAll('.bm-card .bm-name')].map((n) => n.textContent.trim()),
      themeMode: st.themeMode,
      perRow: st.perRow,
      searchEngine: st.searchEngine,
      editMode: st.editMode,
    }
  })

const toasts = (page) =>
  page.evaluate(() =>
    [
      ...new Set([
        ...(window.__toasts || []),
        ...[...document.querySelectorAll('.toast')].map((e) => (e.textContent || '').trim()),
      ]),
    ].filter(Boolean),
  )

/**
 * 打开设置面板的「数据备份」分区。
 *
 * ⚠️ 必须**幂等**：清空类操作跑完之后设置面板**还开着**（`ask()` 只是叠了一层
 *    二次确认），此时再去点工具栏按钮会被 `.modal-mask` 挡住，
 *    一路重试到 30s 超时。第一版就栽在这（场景 3）。
 */
async function openDataSection(page) {
  const alreadyOpen = await page
    .locator('.settings')
    .isVisible()
    .catch(() => false)
  if (!alreadyOpen) {
    await page.locator('.tb-btn').last().click()
    await sleep(800)
  }
  // ⚠️ 限定在 `.settings` 里 —— 页面上可能还有一条数据完整性告警条，
  //    它里面的按钮文案也含「数据备份」。
  await page
    .locator('.settings button', { hasText: '数据备份' })
    .first()
    .click({ timeout: 8000 })
    .catch(() => {})
  await sleep(500)
}

/* 恢复默认设置：修复前叫「恢复默认」，修复后叫「恢复默认设置」——两种都认。 */
const btnResetSettings = (page) =>
  page.locator('.settings button').filter({ hasText: /^\s*恢复默认(设置)?\s*$/ })
/* 恢复默认数据：修复后才有。 */
const btnResetData = (page) => page.locator('.settings button').filter({ hasText: /恢复默认数据/ })

/** 点了但元素不存在时不抛，返回是否点到了（修复前那个按钮不存在）。 */
async function clickIfExists(loc, timeout = 4000) {
  try {
    await loc.first().click({ timeout })
    return true
  } catch {
    return false
  }
}

async function confirmDialog(page) {
  await page.locator('.modal .btn-primary').last().click()
  await sleep(900)
}

/** 起一个干净页面 + 夹具，交给 fn。 */
async function withFixture(fn, { pinSeedVersion = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    ({ cats, bms, settings, pin }) => {
      localStorage.clear()
      localStorage.setItem('jt:categories', JSON.stringify(cats))
      localStorage.setItem('jt:bookmarks', JSON.stringify(bms))
      if (pin) localStorage.setItem('jt:seedVersion', '999') // 钉住：别让 SEED_ADDITIONS 掺进夹具
      localStorage.setItem('jt:settings', JSON.stringify(settings))
    },
    { cats: CATS, bms: BMS, settings: SETTINGS, pin: pinSeedVersion },
  )
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bm-card', { timeout: 20000 })
  await sleep(700)
  const out = await fn(page, ctx)
  await ctx.close()
  return out
}

/* ---------------------------------------------------- 写盘故障注入（场景 7） */

const OBSERVE = `
  ;(function () {
    let log = []
    try { const prev = JSON.parse(window.name || '[]'); if (Array.isArray(prev)) log = prev } catch (e) {}
    window.__toasts = log
    window.__obsReady = false
    const flush = () => { try { window.name = JSON.stringify(window.__toasts) } catch (e) {} }
    const seen = new WeakSet()
    const record = (el) => {
      if (seen.has(el)) return
      seen.add(el)
      const push = () => {
        const txt = (el.textContent || '').trim()
        if (txt && !window.__toasts.includes(txt)) { window.__toasts.push(txt); flush() }
      }
      push(); setTimeout(push, 80); setTimeout(push, 400)
    }
    const scan = (root) => {
      if (!root || root.nodeType !== 1) return
      if (root.classList && root.classList.contains('toast')) record(root)
      if (root.querySelectorAll) root.querySelectorAll('.toast').forEach(record)
    }
    // ⚠️ observe(document, …) 而不是 documentElement —— init script 跑在
    //    readyState==='loading'，那时 documentElement 还是 null，observe 会抛，
    //    整个 IIFE 静默挂掉、观察器根本没装上。
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach(scan)))
      .observe(document, { childList: true, subtree: true })
    window.__obsReady = true
  })()
`

const FAULT = `
  window.__failWrites = false
  ;(function () {
    const orig = Storage.prototype.setItem
    Storage.prototype.setItem = function (k, v) {
      if (window.__failWrites) {
        const e = new Error('QuotaExceededError: simulated')
        e.name = 'QuotaExceededError'
        throw e
      }
      return orig.call(this, k, v)
    }
  })()
`

const browser = await pw.chromium.launch({ headless: true })

/* ================== 0 验收：全新用户的默认配置必须完整（含两条新链接） */
console.log('\n' + '='.repeat(84))
console.log('  0 · 全新用户（localStorage 全空）—— 默认配置必须完整，且含两条新链接')
console.log('='.repeat(84))
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await sleep(1500)
  const r = await snap(page)
  console.log(`  存储：${r.catIds.length} 个分类 / ${r.bmIds.length} 条书签；界面 ${r.cards} 张卡`)
  console.log(`  种子期望：${SEED_CAT_N} 个分类 / ${SEED_BM_N} 条书签`)
  check('全新用户拿到了完整的默认分类', r.catIds.length === SEED_CAT_N, `${r.catIds.length} ≠ ${SEED_CAT_N}`)
  check('全新用户拿到了完整的默认书签', r.bmIds.length === SEED_BM_N, `${r.bmIds.length} ≠ ${SEED_BM_N}`)
  for (const w of WANT) {
    check(`默认配置里有 ${w.label}`, r.bmUrls.some((u) => String(u).includes(w.key)), JSON.stringify(r.bmUrls.slice(0, 3)))
  }
  check('界面渲染出了默认卡片', r.cards > 0, `${r.cards} 张`)
  await ctx.close()
}

/* ========== 0b 反向：老用户升级只补新条目，不能覆盖他自己那份数据 */
console.log('\n' + '='.repeat(84))
console.log('  0b · 反向：老用户（有数据、`seedVersion` 缺失）—— 只补新条目，不覆盖')
console.log('='.repeat(84))
{
  const r = await withFixture(
    async (page) => {
      await sleep(1400)
      return snap(page)
    },
    { pinSeedVersion: false }, // 故意不写 jt:seedVersion，模拟老版本升级上来
  )
  console.log(`  升级后：${r.catIds.length} 个分类 / ${r.bmIds.length} 条书签 → ${JSON.stringify(r.bmIds)}`)
  check('原有的 3 条书签一条都没丢', ['k1', 'k2', 'k3'].every((id) => r.bmIds.includes(id)), JSON.stringify(r.bmIds))
  check('原有的 2 个分类一个都没丢', ['cat_a', 'cat_b'].every((id) => r.catIds.includes(id)), JSON.stringify(r.catIds))
  check('补进来的书签都是种子里的', r.bmIds.filter((id) => !id.startsWith('k')).every((id) => seedBookmarks.some((b) => b.id === id)), JSON.stringify(r.bmIds))
  for (const w of WANT) {
    check(`新增条目里有 ${w.label}`, r.bmUrls.some((u) => String(u).includes(w.key)), JSON.stringify(r.bmUrls))
  }
}

/* ========== 1 诊断：点「恢复默认(设置)」对书签 / 分类有没有影响 */
console.log('\n' + '='.repeat(84))
console.log('  1 · 诊断：点「恢复默认」(设置) —— 书签和分类会被清掉吗？')
console.log('='.repeat(84))
{
  const r = await withFixture(async (page) => {
    await openDataSection(page)
    const before = await snap(page)
    const hit = await clickIfExists(btnResetSettings(page))
    await sleep(900)
    const after = await snap(page)
    return { before, after, hit }
  })
  console.log(`  点之前：${r.before.catIds.length} 分类 / ${r.before.bmIds.length} 书签`)
  console.log(`  点之后：${r.after.catIds.length} 分类 / ${r.after.bmIds.length} 书签`)
  check('确实点到了那个按钮（前提成立）', r.hit, '没找到按钮')
  check('书签没有被清掉', r.after.bmIds.length === 3, `${r.after.bmIds.length} 条 ${JSON.stringify(r.after.bmIds)}`)
  check('分类没有被清掉', r.after.catIds.length === 2, `${r.after.catIds.length} 个 ${JSON.stringify(r.after.catIds)}`)
  check('自定义书签的名字也没变', JSON.stringify(r.after.bmNames) === JSON.stringify(r.before.bmNames), JSON.stringify(r.after.bmNames))
}

/* ========== 2 诊断：点「恢复默认(设置)」的真实职责 —— 设置回默认 */
console.log('\n' + '='.repeat(84))
console.log('  2 · 诊断：点「恢复默认」(设置) —— 设置项有没有回到默认值？')
console.log('='.repeat(84))
{
  const r = await withFixture(async (page) => {
    await openDataSection(page)
    const before = await snap(page)
    await clickIfExists(btnResetSettings(page))
    await sleep(900)
    return { before, after: await snap(page) }
  })
  console.log(`  点之前：themeMode=${r.before.themeMode} perRow=${r.before.perRow} searchEngine=${r.before.searchEngine} editMode=${r.before.editMode}`)
  console.log(`  点之后：themeMode=${r.after.themeMode} perRow=${r.after.perRow} searchEngine=${r.after.searchEngine} editMode=${r.after.editMode}`)
  check('前提：夹具的设置确实不是默认值', r.before.themeMode === 'Dark' && r.before.perRow === 3, JSON.stringify(r.before))
  check('themeMode 回到默认（system）', r.after.themeMode === 'system', String(r.after.themeMode))
  check('perRow 回到默认（5）', r.after.perRow === 5, String(r.after.perRow))
  check('searchEngine 回到默认（baidu）', r.after.searchEngine === 'baidu', String(r.after.searchEngine))
  check('editMode 回到默认（false）', r.after.editMode === false, String(r.after.editMode))
}

/* ========== 3 诊断：清空之后，刷新并不会把默认数据灌回来（「没有路」这个前提） */
console.log('\n' + '='.repeat(84))
console.log('  3 · 诊断：清空书签+分类后刷新 —— 默认数据会自己回来吗？')
console.log('='.repeat(84))
{
  const r = await withFixture(async (page) => {
    await openDataSection(page)
    await page.locator('.settings button', { hasText: '清除所有书签' }).first().click()
    await sleep(400)
    await confirmDialog(page)
    await openDataSection(page)
    await page.locator('.settings button', { hasText: '清除分类' }).first().click()
    await sleep(400)
    await confirmDialog(page)
    const cleared = await snap(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await sleep(1500)
    return { cleared, reloaded: await snap(page) }
  })
  console.log(`  清空后：${r.cleared.catIds.length} 分类 / ${r.cleared.bmIds.length} 书签`)
  console.log(`  刷新后：${r.reloaded.catIds.length} 分类 / ${r.reloaded.bmIds.length} 书签`)
  check('前提：确实清空了', r.cleared.bmIds.length === 0 && r.cleared.catIds.length === 0, JSON.stringify(r.cleared))
  check('刷新后仍然是空的（这是 2026-09-27 有意为之的判据）', r.reloaded.bmIds.length === 0, `${r.reloaded.bmIds.length} 条`)
  check('刷新后分类也仍然是空的', r.reloaded.catIds.length === 0, `${r.reloaded.catIds.length} 个`)
}

/* ========== 4 验收：「恢复默认数据」把整套默认配置灌回来 */
console.log('\n' + '='.repeat(84))
console.log('  4 · 「恢复默认数据」—— 默认分类 + 默认书签整套回来，自定义数据被覆盖')
console.log('='.repeat(84))
{
  const r = await withFixture(async (page) => {
    await openDataSection(page)
    const hit = await clickIfExists(btnResetData(page))
    if (hit) await confirmDialog(page)
    const after = await snap(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await sleep(1500)
    return { hit, after, reloaded: await snap(page) }
  })
  console.log(`  按钮存在：${r.hit}`)
  console.log(`  恢复后：${r.after.catIds.length} 分类 / ${r.after.bmIds.length} 书签，界面 ${r.after.cards} 张卡`)
  console.log(`  刷新后：${r.reloaded.catIds.length} 分类 / ${r.reloaded.bmIds.length} 书签，界面 ${r.reloaded.cards} 张卡`)

  check('设置面板里有「恢复默认数据」这个入口', r.hit, '按钮不存在')
  check('分类恢复成了整套默认分类', r.after.catIds.length === SEED_CAT_N, `${r.after.catIds.length} ≠ ${SEED_CAT_N}`)
  check('书签恢复成了整套默认书签', r.after.bmIds.length === SEED_BM_N, `${r.after.bmIds.length} ≠ ${SEED_BM_N}`)
  check(
    '默认分类的 id 与种子逐个一致',
    JSON.stringify([...r.after.catIds].sort()) === JSON.stringify(seedCategories.map((c) => c.id).sort()),
    JSON.stringify(r.after.catIds),
  )
  check(
    '默认书签的 id 与种子逐个一致',
    JSON.stringify([...r.after.bmIds].sort()) === JSON.stringify(seedBookmarks.map((b) => b.id).sort()),
    JSON.stringify(r.after.bmIds),
  )
  for (const w of WANT) {
    check(`恢复出来的默认配置含 ${w.label}`, r.after.bmUrls.some((u) => String(u).includes(w.key)), JSON.stringify(r.after.bmUrls.slice(0, 3)))
  }
  check('自定义书签已被覆盖（k1/k2/k3 不在了）', !['k1', 'k2', 'k3'].some((id) => r.after.bmIds.includes(id)), JSON.stringify(r.after.bmIds))
  check('界面把默认卡片渲染出来了', r.after.cards === SEED_BM_N, `${r.after.cards} 张 ≠ ${SEED_BM_N}`)
  check('刷新后依然是默认配置（真落盘了，不是只在内存里）', r.reloaded.bmIds.length === SEED_BM_N && r.reloaded.catIds.length === SEED_CAT_N, `${r.reloaded.catIds.length}/${r.reloaded.bmIds.length}`)
}

/* ========== 5 反向：点「恢复默认数据」再取消 —— 一条都不能动 */
console.log('\n' + '='.repeat(84))
console.log('  5 · 反向：点「恢复默认数据」后点「取消」—— 数据一条都不许动')
console.log('='.repeat(84))
{
  const r = await withFixture(async (page) => {
    await openDataSection(page)
    const before = await snap(page)
    const hit = await clickIfExists(btnResetData(page))
    if (hit) {
      await page.locator('.modal .btn-ghost').last().click() // 取消
      await sleep(700)
    }
    return { before, after: await snap(page), hit }
  })
  check('确实点到了那个按钮（前提成立）', r.hit, '没找到按钮')
  check('取消之后书签没变', r.after.bmIds.length === 3, `${r.after.bmIds.length} 条`)
  check('取消之后分类没变', r.after.catIds.length === 2, `${r.after.catIds.length} 个`)
  check('取消之后名字也没变', JSON.stringify(r.after.bmNames) === JSON.stringify(r.before.bmNames), JSON.stringify(r.after.bmNames))
}

/* ========== 6 集成：恢复默认数据之后，另一个标签页要跟着变 */
console.log('\n' + '='.repeat(84))
console.log('  6 · 集成：A 标签页恢复默认数据 → B 标签页的内存态必须跟上')
console.log('='.repeat(84))
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const a = await ctx.newPage()
  await a.goto(BASE, { waitUntil: 'domcontentloaded' })
  await a.evaluate(
    ({ cats, bms, settings }) => {
      localStorage.clear()
      localStorage.setItem('jt:categories', JSON.stringify(cats))
      localStorage.setItem('jt:bookmarks', JSON.stringify(bms))
      localStorage.setItem('jt:seedVersion', '999')
      localStorage.setItem('jt:settings', JSON.stringify(settings))
    },
    { cats: CATS, bms: BMS, settings: SETTINGS },
  )
  await a.goto(BASE, { waitUntil: 'domcontentloaded' })
  await a.waitForSelector('.bm-card', { timeout: 20000 })
  await sleep(600)
  const b = await ctx.newPage()
  await b.goto(BASE, { waitUntil: 'domcontentloaded' })
  await b.waitForSelector('.bm-card', { timeout: 20000 })
  await sleep(800)
  const bBefore = await snap(b)

  await openDataSection(a)
  const hit = await clickIfExists(btnResetData(a))
  if (hit) await confirmDialog(a)
  await sleep(1200)

  const bAfter = await snap(b)
  console.log(`  B 标签页：${bBefore.cards} 张卡 → ${bAfter.cards} 张卡`)
  check('前提：两个标签页都拿到了夹具（3 张卡）', bBefore.cards === 3, `${bBefore.cards} 张`)
  check('A 确实点到了按钮（前提成立）', hit, '没找到按钮')
  check('B 标签页的卡片跟着变了', bAfter.cards === SEED_BM_N, `${bAfter.cards} 张 ≠ ${SEED_BM_N}`)
  check('B 标签页内存里的分类也跟上了', bAfter.catIds.length === SEED_CAT_N, `${bAfter.catIds.length} 个`)
  await ctx.close()
}

/* ========== 7 反向：写盘失败时必须如实报失败 + 回滚，不能谎报成功 */
console.log('\n' + '='.repeat(84))
console.log('  7 · 反向：写盘失败 —— 不许谎报「已恢复默认数据」')
console.log('='.repeat(84))
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  await page.addInitScript({ content: FAULT })
  await page.addInitScript({ content: OBSERVE })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    ({ cats, bms, settings }) => {
      localStorage.clear()
      localStorage.setItem('jt:categories', JSON.stringify(cats))
      localStorage.setItem('jt:bookmarks', JSON.stringify(bms))
      localStorage.setItem('jt:seedVersion', '999')
      localStorage.setItem('jt:settings', JSON.stringify(settings))
    },
    { cats: CATS, bms: BMS, settings: SETTINGS },
  )
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bm-card', { timeout: 20000 })
  await sleep(700)

  if (!(await page.evaluate(() => window.__obsReady === true))) {
    await ctx.close()
    throw new Error('toast 观察器没装上（OBSERVE 注入失败）—— 本轮结果不可信，别当绿看')
  }
  await page.evaluate(() => {
    window.__toasts = []
    window.name = '[]'
  })

  await openDataSection(page)
  const hit = await clickIfExists(btnResetData(page))
  await page.evaluate(() => {
    window.__failWrites = true // 从现在起所有 setItem 都抛
  })
  if (hit) await confirmDialog(page)
  await sleep(600)

  const seen = await toasts(page)
  const after = await snap(page)
  console.log(`  toast：${JSON.stringify(seen)}`)
  console.log(`  写失败后内存里：${after.catIds.length} 分类 / ${after.bmIds.length} 书签，界面 ${after.cards} 张卡`)

  check('探针确实读到了 toast（防空读假绿）', seen.length > 0, JSON.stringify(seen))
  check('没有出现「已恢复默认数据」这类成功文案', !seen.some((s) => s.includes('已恢复默认数据')), JSON.stringify(seen))
  check('如实报了失败', seen.some((s) => s.includes('恢复默认数据失败') || s.includes('失败')), JSON.stringify(seen))
  check('内存回滚了：界面还是夹具那 3 张卡', after.cards === 3, `${after.cards} 张`)
  check('存储里也还是夹具（没被写坏）', after.bmIds.length === 3 && after.catIds.length === 2, `${after.catIds.length}/${after.bmIds.length}`)
  await ctx.close()
}

await browser.close()
console.log(`\n${'='.repeat(60)}\n通过 ${pass} / 失败 ${fail}`)
if (failures.length) console.log(`失败项（${failures.length}）：\n  - ${failures.join('\n  - ')}`)
console.log()
process.exit(fail ? 1 : 0)
