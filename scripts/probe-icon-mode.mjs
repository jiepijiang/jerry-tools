#!/usr/bin/env node
/**
 * 图标来源（iconMode）等价性 / 语义核对。
 * ---------------------------------------------------------------------------
 * ## 这个脚本要证明的一件事
 *
 * 2026-10-14 给书签加了 `iconMode` 字段（initial / favicon / custom），
 * 并把**所有渲染调用点**从 `faviconOf(url, icon)` 换成了 `iconSrcFor(item)`。
 *
 * 换调用点最怕的就是「顺手改坏了存量数据的显示」—— 而这种坏**不会报错**，
 * 只会让某几百张卡片悄悄换成另一张图。所以这里把「等价」写死成断言：
 *
 *   【1】对**没有 iconMode 字段**的存量数据，
 *        `iconSrcFor(item)` 必须与 `faviconOf(item.url, item.icon)` **逐条相同**。
 *        语料用真实的种子数据（seedBookmarks + 377 条 seedSites），
 *        再补一批合成的边角情况。
 *
 * ## 为什么语料要用真种子而不是自己编
 *
 * `seed.js` 里有 9 条**有意留空** `icon` 的记录、`seed-discover.js` 里有
 * 37 条被清空的坏地址（第三方 favicon 服务 / 明文 http）。
 * 这些正是最容易在重构里被改掉行为的那批 —— 自己编的语料想不到它们。
 *
 * 用法：node scripts/probe-icon-mode.mjs   （退出码 1 = 有不符合预期的）
 */

import { faviconOf, iconSrcFor, resolveIconMode, isUsableIcon, ICON_MODES } from '../src/utils/helpers.js'
import { seedBookmarks } from '../src/data/seed.js'
import { seedSites } from '../src/data/seed-discover.js'

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

/* ------------------------------------------------------------------ */
/* 语料                                                                */
/* ------------------------------------------------------------------ */

/** 合成边角：这些是真实数据里不一定有、但代码路径必须走过的形状。 */
const SYNTHETIC = [
  { name: '正常 https', url: 'https://github.com' },
  { name: '自定义图标（可用）', url: 'https://github.com', icon: 'https://github.com/icon.png' },
  { name: '自定义图标（第三方服务 → 应被挡）', url: 'https://github.com', icon: 'https://icons.duckduckgo.com/ip3/github.com.ico' },
  { name: '自定义图标（明文 http → 应被挡）', url: 'https://regex101.com', icon: 'http://regex101.com/icon.ico' },
  { name: '自定义图标（data URL）', url: 'https://a.com', icon: 'data:image/png;base64,AAAA' },
  { name: '自定义图标（站内相对路径）', url: 'https://a.com', icon: '/static/img/x.png' },
  { name: 'icon 是空串', url: 'https://a.com', icon: '' },
  { name: 'icon 是空白串', url: 'https://a.com', icon: '   ' },
  { name: 'url 缺协议', url: 'github.com' },
  { name: 'url 是空串', url: '', icon: '' },
  { name: 'url 无法解析', url: 'not a url', icon: '' },
  { name: '没有 url 字段', icon: '' },
]

/** 真实存量数据：种子书签 + 发现页站点，**一条都不加 iconMode**。 */
const LEGACY = [
  ...seedBookmarks.map((b) => ({ ...b, __from: 'seedBookmarks' })),
  ...seedSites.map((s) => ({ ...s, __from: 'seedSites' })),
  ...SYNTHETIC.map((s) => ({ ...s, __from: 'synthetic' })),
]

console.log(`语料：seedBookmarks ${seedBookmarks.length} + seedSites ${seedSites.length} + synthetic ${SYNTHETIC.length} = ${LEGACY.length} 条\n`)

/* ------------------------------------------------------------------ */
/* 【1】等价性：存量数据上 iconSrcFor 必须与老写法完全一致              */
/* ------------------------------------------------------------------ */

let diff = 0
const diffSamples = []
for (const item of LEGACY) {
  const oldWay = faviconOf(item.url, item.icon)
  const newWay = iconSrcFor(item)
  if (oldWay !== newWay) {
    diff++
    if (diffSamples.length < 5) diffSamples.push(`${item.__from} ${item.name || item.title || '(无名)'}: ${JSON.stringify(oldWay)} vs ${JSON.stringify(newWay)}`)
  }
}
check(
  `【1】存量数据等价：${LEGACY.length} 条上 iconSrcFor == faviconOf`,
  diff === 0,
  diff ? `${diff} 条不一致\n     ${diffSamples.join('\n     ')}` : '',
)

/* ------------------------------------------------------------------ */
/* 【2】iconMode 缺省时的推断：icon 非空 → custom，空 → favicon         */
/* ------------------------------------------------------------------ */

const inferred = LEGACY.filter((i) => {
  const expect = String(i.icon || '').trim() ? 'custom' : 'favicon'
  return resolveIconMode(i) !== expect
})
check(`【2】缺省 iconMode 的推断（${LEGACY.length} 条）`, inferred.length === 0, inferred.slice(0, 3).map((i) => `${i.url} → ${resolveIconMode(i)}`).join('；'))

/* ------------------------------------------------------------------ */
/* 【3】initial：必须返回空串（不渲染 <img>），且**与 url / icon 无关**  */
/* ------------------------------------------------------------------ */

const initialItems = [
  { url: 'https://github.com', icon: 'https://github.com/x.png', iconMode: 'initial' },
  { url: 'https://a.com', icon: '', iconMode: 'initial' },
  { url: '', icon: '', iconMode: 'initial' },
  { url: 'not a url', icon: 'data:image/png;base64,AA', iconMode: 'initial' },
]
const initialBad = initialItems.filter((i) => iconSrcFor(i) !== '')
check('【3】initial 一律返回空串（不受 url / icon 影响）', initialBad.length === 0, JSON.stringify(initialBad.map((i) => iconSrcFor(i))))

/* ------------------------------------------------------------------ */
/* 【4】favicon：必须忽略 icon 字段，只给站点自己的 /favicon.ico        */
/* ------------------------------------------------------------------ */

const favItem = { url: 'https://github.com/foo/bar', icon: 'https://evil.example/x.png', iconMode: 'favicon' }
check(
  '【4】favicon 忽略 icon 字段，取站点 origin 的 /favicon.ico',
  iconSrcFor(favItem) === 'https://github.com/favicon.ico',
  iconSrcFor(favItem),
)

/* ------------------------------------------------------------------ */
/* 【5】custom：用 icon 字段；不合格时**仍**回落站点图标（老行为）      */
/* ------------------------------------------------------------------ */

const customOk = { url: 'https://a.com', icon: 'https://cdn.a.com/i.png', iconMode: 'custom' }
const customBad = { url: 'https://a.com', icon: 'https://icons.duckduckgo.com/ip3/a.com.ico', iconMode: 'custom' }
check('【5a】custom + 合格地址 → 用该地址', iconSrcFor(customOk) === 'https://cdn.a.com/i.png', iconSrcFor(customOk))
check(
  '【5b】custom + 不合格地址 → 回落到站点 /favicon.ico（不把坏地址丢给 img）',
  iconSrcFor(customBad) === 'https://a.com/favicon.ico',
  iconSrcFor(customBad),
)

/* ------------------------------------------------------------------ */
/* 【6】坏值兜底：iconMode 是垃圾值时按老行为推断，不抛错               */
/* ------------------------------------------------------------------ */

const garbage = [
  { url: 'https://a.com', icon: '', iconMode: 'nonsense' },
  { url: 'https://a.com', icon: 'https://a.com/i.png', iconMode: 'nonsense' },
  { url: 'https://a.com', icon: '', iconMode: null },
  { url: 'https://a.com', icon: '', iconMode: 42 },
]
let threw = null
let garbageBad = []
try {
  garbageBad = garbage.filter((i) => iconSrcFor(i) !== faviconOf(i.url, i.icon))
} catch (e) {
  threw = e
}
check('【6】iconMode 是垃圾值时不抛错、按老行为推断', !threw && garbageBad.length === 0, threw ? String(threw) : JSON.stringify(garbageBad))

/* ------------------------------------------------------------------ */
/* 【7】ICON_MODES 常量与文档一致                                       */
/* ------------------------------------------------------------------ */

check('【7】ICON_MODES 恰好是 initial / favicon / custom', JSON.stringify(ICON_MODES) === JSON.stringify(['initial', 'favicon', 'custom']), JSON.stringify(ICON_MODES))

/* ------------------------------------------------------------------ */
/* 【8】种子数据的实际分布（打印用，顺带确认语料不是空的）              */
/* ------------------------------------------------------------------ */

const seedWithIcon = seedBookmarks.filter((b) => String(b.icon || '').trim()).length
const seedEmpty = seedBookmarks.length - seedWithIcon
const sitesWithIcon = seedSites.filter((s) => isUsableIcon(s.icon)).length
console.log(`\n  · seedBookmarks：${seedWithIcon} 条有 icon / ${seedEmpty} 条留空（留空的会显示首字母块）`)
console.log(`  · seedSites：${sitesWithIcon} / ${seedSites.length} 条的 icon 可用（其余是坏地址或空，回落到 /favicon.ico）`)
check('【8】语料非空（种子数据真的读到了）', seedBookmarks.length > 0 && seedSites.length > 0)

/* ------------------------------------------------------------------ */

console.log(`\n通过 ${pass} / 失败 ${fail}`)
if (fail) {
  console.log('\n❌ 有问题：')
  for (const f of failures) console.log(`   · ${f}`)
  process.exit(1)
}
