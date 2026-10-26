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
 *
 * ── 第二轮（2026-10-14）：favicon 模式改成「读页面 HTML」────────────────
 *
 * 起因：填 `https://jiepijiang.github.io/jerry-site/` 抓到的是 **Vue 的 logo**。
 * 根因是 `faviconOf()` 取 `origin`、丢掉路径 —— GitHub Pages **项目站**
 * （`user.github.io/repo/`）的 `/favicon.ico` 一律 404，于是落到了
 * **域名根**的图标（用户主页仓库的 Vue logo）。四站全是项目站，全中招。
 *
 * 改法：`resolveSiteIcon()` 去读页面 `<head>` 里的 `<link rel="icon">`，
 * 结果**存进 `icon` 字段当缓存**。于是本脚本多了两处：
 *
 *   · 【4】从「favicon 必须忽略 icon 字段」改成
 *          「icon 有值就用它（4b）/ 为空才回落（4a）/ 坏地址仍被挡（4c）」；
 *   · 【9】`extractIconHref()` 的纯函数用例 —— 解析器零依赖，
 *          所以能放进这个**进 CI**的脚本（跑在 `npm ci` 之前）。
 */

import {
  ICON_MODES,
  extractIconHref,
  fallbackIconFor,
  faviconOf,
  iconSrcFor,
  isUsableIcon,
  resolveIconMode,
} from '../src/utils/helpers.js'
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
/* 【4】favicon：`icon` 是「解析到的真图标地址」的缓存                   */
/* ------------------------------------------------------------------ */

/*
 * ⚠️ 2026-10-14（第二轮）语义变了，这里的三条一起钉住它。
 *
 * 老断言是「favicon 必须**忽略** icon 字段」—— 那是在 `icon` 只代表
 * 「用户填的自定义地址」的年代写的。现在 favicon 模式下 `icon` 存的是
 * `resolveSiteIcon()` 从页面 HTML 里解析出来的**真图标地址**，
 * 所以它**必须被用上**，否则这次修复等于没做。
 */

// 4a 存量数据 / 解析失败 → 回落 origin 的 /favicon.ico（老行为，不能变）
const favEmpty = { url: 'https://github.com/foo/bar', icon: '', iconMode: 'favicon' }
check(
  '【4a】favicon + icon 为空 → 回落站点 origin 的 /favicon.ico（老行为）',
  iconSrcFor(favEmpty) === 'https://github.com/favicon.ico',
  iconSrcFor(favEmpty),
)

// 4b 解析到了真图标 → 用它。**这一条就是「填主站链接抓到 Vue 图标」那个 bug 的判据**
const REAL_ICON = 'https://jiepijiang.github.io/jerry-site/static/img/favicon.jpg'
const favReal = { url: 'https://jiepijiang.github.io/jerry-site/', icon: REAL_ICON, iconMode: 'favicon' }
check(
  '【4b】favicon + icon 有值 → 用解析到的真图标（不再去猜 /favicon.ico）',
  iconSrcFor(favReal) === REAL_ICON,
  iconSrcFor(favReal),
)

// 4c 缓存里躺的是坏地址 → 守卫仍然把它挡掉。这条证明 4b 不是「什么都放行」
const favBad = { url: 'https://a.com', icon: 'https://icons.duckduckgo.com/ip3/a.com.ico', iconMode: 'favicon' }
check(
  '【4c】favicon + 缓存地址不合格（第三方服务）→ 回落到 /favicon.ico（守卫仍在）',
  iconSrcFor(favBad) === 'https://a.com/favicon.ico',
  iconSrcFor(favBad),
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
/* 【9】extractIconHref —— 从页面 HTML 里挑真图标                        */
/* ------------------------------------------------------------------ */

/*
 * 这一组是 2026-10-14 第二轮加的：favicon 模式从「猜 /favicon.ico」改成
 * 「读页面 HTML」。解析器是纯函数，所以能放在**进 CI 的**这个脚本里。
 *
 * ⚠️ 每条都要有**判别力** —— 光测「能挑出来」不够，
 *    还得测「不该挑的挑不出来」（注释里的、mask-icon、data:）。
 */

/** 主站用的基准：GitHub Pages **项目站**，路径里有 /jerry-site/。 */
const BASE = 'https://jiepijiang.github.io/jerry-site/'

const PARSER_CASES = [
  // [名字, HTML, 期望]
  [
    '主站真图标（绝对路径带仓库前缀）',
    '<link rel="icon" href="/jerry-site/static/img/favicon.jpg" type="image/jpeg" />',
    'https://jiepijiang.github.io/jerry-site/static/img/favicon.jpg',
  ],
  // ⚠️ 这条最容易写错：`/a.png` 是**绝对路径**，要从**域名根**解析，
  //    不是从 base 的 /jerry-site/ 解析。写成后者会把 /jerry-site/a.png 当成对的。
  ['绝对路径从域名根解析', '<link href="/a.png" rel="icon">', 'https://jiepijiang.github.io/a.png'],
  ['相对路径按 base 的目录解析', '<link rel="icon" href="favicon.png">', 'https://jiepijiang.github.io/jerry-site/favicon.png'],
  ['协议相对地址', '<link rel="icon" href="//cdn.x.com/i.png">', 'https://cdn.x.com/i.png'],
  ['shortcut icon（老写法）', '<link rel="shortcut icon" href="/s.ico">', 'https://jiepijiang.github.io/s.ico'],
  ['alternate icon（GitHub 的 .ico 兜底）', '<link rel="alternate icon" href="/f.ico">', 'https://jiepijiang.github.io/f.ico'],
  ['单引号属性', "<link rel='icon' href='/q.png'>", 'https://jiepijiang.github.io/q.png'],
  ['无引号属性', '<link rel=icon href=/u.png>', 'https://jiepijiang.github.io/u.png'],
  ['属性顺序颠倒（href 在前）', '<link href="/r.png" rel="icon">', 'https://jiepijiang.github.io/r.png'],
  ['注释掉的旧图标要忽略', '<!-- <link rel="icon" href="/old.ico"> --><link rel="icon" href="/new.png">', 'https://jiepijiang.github.io/new.png'],
  [
    'script 里的字符串要忽略',
    '<script>const t = "<link rel=\\"icon\\" href=/fake.png>";</script><link rel="icon" href="/real.png">',
    'https://jiepijiang.github.io/real.png',
  ],
  ['mask-icon 不要（单色，当图标会变黑块）', '<link rel="mask-icon" href="/m.svg" color="#000"><link rel="icon" href="/i.png">', 'https://jiepijiang.github.io/i.png'],
  ['只有 apple-touch-icon 时用它兜底', '<link rel="apple-touch-icon" href="/a.png" sizes="180x180">', 'https://jiepijiang.github.io/a.png'],
  ['icon 档位优先于 apple-touch-icon', '<link rel="apple-touch-icon" href="/a.png"><link rel="icon" href="/i.png">', 'https://jiepijiang.github.io/i.png'],
  ['同档位取 sizes 大的', '<link rel="icon" href="/s.png" sizes="16x16"><link rel="icon" href="/l.png" sizes="32x32">', 'https://jiepijiang.github.io/l.png'],
  ['sizes=any（矢量）当最大', '<link rel="icon" href="/v.png" sizes="16x16"><link rel="icon" href="/any.svg" sizes="any">', 'https://jiepijiang.github.io/any.svg'],
  ['data: 图标要跳过（塞进 icon 字段会撑爆数据）', '<link rel="icon" href="data:image/png;base64,AAAA">', ''],
  ['没有任何声明', '<html><head><title>x</title></head></html>', ''],
  ['href 是空串', '<link rel="icon" href="">', ''],
  ['baseUrl 解析不了', '<link rel="icon" href="/i.png">', ''],
]

let parserBad = 0
const parserFails = []
for (const [name, html, want] of PARSER_CASES) {
  const base = name === 'baseUrl 解析不了' ? 'not a url' : BASE
  const got = extractIconHref(html, base)
  if (got !== want) {
    parserBad++
    parserFails.push(`${name}：得到 ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}`)
  }
}
check(`【9a】extractIconHref 的 ${PARSER_CASES.length} 个用例`, parserBad === 0, parserFails.join('\n     '))

// 【9b】判别力自检：把解析器的排序反过来（apple 优先于 icon）应该至少红一条 ——
//       证明上面那组不是「怎么写都能过」。
const DISCRIMINATION_HTML =
  '<link rel="apple-touch-icon" href="/a.png"><link rel="icon" href="/i.png">'
check(
  '【9b】判别力：icon / apple-touch-icon 同时存在时，结果确实是 icon 那一档',
  extractIconHref(DISCRIMINATION_HTML, BASE) === 'https://jiepijiang.github.io/i.png',
  extractIconHref(DISCRIMINATION_HTML, BASE),
)

// 【9c】真实页面语料：四站的 index.html 里那段 `<link rel="icon">` 长什么样，
//       解析出来的必须是**带仓库前缀**的地址（也就是这次修复的核心）。
check(
  '【9c】主站真图标解析出来带 /jerry-site/ 前缀（不是域名根的 /favicon.ico）',
  extractIconHref(
    '<link rel="icon" href="/jerry-site/static/img/favicon.jpg" type="image/jpeg" />',
    'https://jiepijiang.github.io/jerry-site/',
  ).includes('/jerry-site/'),
)

/* ── 【10】fallbackIconFor：图标**加载失败**后的第二候选 ─────────────
 *
 * 为什么值得单独测：这段逻辑决定「坏链能不能自愈」，
 * 而它的**反面**（什么时候**不该**回落）比正面更重要 —— 判错会无限重试。
 *
 * 双向覆盖（防退化成常量），实测过：
 *   · 恒返回 ''    → 第 1、2、7、8 条红；
 *   · 忽略 src 恒返回 guess → 第 3、4 条红
 *     （5、6 不会红 —— pageUrl 非法时 `new URL` 抛错，仍然返回 ''）。
 */
const FALLBACK_CASES = [
  ['https://a.io/bad.png', 'https://a.io/page', 'https://a.io/favicon.ico', '常规：坏链 → 页面 origin 的兜底'],
  ['https://cdn.other.io/i.png', 'https://a.io/page', 'https://a.io/favicon.ico', '图标在别的域 → 回落到**页面**的 origin，不是图标的'],
  ['https://a.io/favicon.ico', 'https://a.io/page', '', 'src 本身就是兜底地址 → 不再试（否则无限循环）'],
  ['', 'https://a.io/page', '', 'src 为空 → 没有可试的'],
  ['https://a.io/bad.png', '', '', 'pageUrl 为空 → 推导不出来'],
  ['https://a.io/bad.png', ':::', '', 'pageUrl 非法 → 不瞎猜'],
  ['https://a.io/bad.png', 'a.io/page', 'https://a.io/favicon.ico', 'pageUrl 省略协议也能推导'],
  ['https://a.io/bad.png', 'https://a.io:8443/page', 'https://a.io:8443/favicon.ico', '保留非默认端口'],
]
const fbFails = []
FALLBACK_CASES.forEach(([src, page, want, why], i) => {
  const got = fallbackIconFor(src, page)
  if (got !== want) {
    fbFails.push(`#${i + 1} ${why}\n       期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`)
  }
})
check(`【10】fallbackIconFor 的 ${FALLBACK_CASES.length} 个用例`, fbFails.length === 0, fbFails.join('\n     '))

/* ------------------------------------------------------------------ */

console.log(`\n通过 ${pass} / 失败 ${fail}`)
if (fail) {
  console.log('\n❌ 有问题：')
  for (const f of failures) console.log(`   · ${f}`)
  process.exit(1)
}
