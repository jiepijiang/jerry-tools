/* =========================================================================
   check-i18n-text.mjs —— **第三道** i18n 守卫：静态扫「硬编码文案」

   （原名 `i18n-text-guard.mjs`，住在 /tmp；2026-10-05 搬进仓库并改成本名。）

   为什么需要第三道（前两道各有一个结构性盲区）：

     | 守卫                | 扫什么                        | 盲区 |
     |---------------------|-------------------------------|------|
     | `i18n-parity.mjs`   | 源码里 `t('…')` 的**字面量**  | 压根没调 `t()` 的字符串它看不见 |
     | `i18n-render.mjs`   | **正常渲染**出来的页面文字    | 只在错误分支 / 冷门分支出现的文案扫不到 |
     | **本脚本**          | **引号里的中文**（静态）      | —— |

   典型漏网：登录失败时的「邮箱或密码不正确」——
   只有输错密码才显示，正常扫页面永远碰不到。
   2026-10-02 实测：这一道扫出 **94 处**，其中用户可见的约 25 条。

   做法：
     1. 逐行剥掉注释（行注释 / 块注释 / HTML 注释），找引号里的中文
     2. 跳过**数据文件**（中文是数据本身，不是文案）—— 名单在下面，每条都有理由
     3. 跳过**开发期上下文**（`console.*` / `Error` 的消息不进界面）——
        向上回看同一个「语句块」，块里出现 console/Error 就跳过
     4. 额外交叉校验：`useClock.js` 的 `WMO_CODES` 每一个都要有
        `weather.wmo.<code>` 的 key（中英都要有）—— 这类**动态拼出来的 key**
        前两道守卫也扫不到

   用法：node scripts/check-i18n-text.mjs   （npm run check:i18n 会带上它；退出码 1 = 有未处理项）
   ========================================================================= */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// 由**脚本自己的位置**推出来 —— 别写死绝对路径，CI 里路径不一样。
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')

/** 文案总表本身，不用扫。 */
const SKIP_FILES = new Set(['data/i18n.js'])

/**
 * **数据文件**：这里的中文是数据本身，不是「该翻译的文案」。
 * 每条都要写清楚为什么，不然这份名单会慢慢变成「把碍事的都塞进来」。
 */
const DATA_FILES = new Map([
  ['utils/geo.js', '中文地名后缀表（用来解析天气城市名）'],
  ['utils/lunar.js', '农历：干支 / 节气 / 节日 / 月日名 —— 农历本来就是中文的'],
  ['data/seed.js', '种子数据（搜索引擎名等）'],
  ['data/seed-discover.js', '种子数据（377 个站点的名字）'],
  ['data/options.js', '选项表（布局 / 密度 / 主题这些的 id）'],
])

/** 中文判定 + 「文案」的最小长度（单字基本是数据表项）。 */
const CJK = /[\u4e00-\u9fff]/
const MIN_LEN = 3

/** 开发期上下文：这些消息进的是控制台，不是界面。 */
const DEV_CTX = /console\.(log|warn|error|info|debug)|new Error\(|throw /

/**
 * 明确放行的**单条**（文件 + 文本片段），每条写清楚为什么它不是文案。
 *
 * ⚠️ 有意做成「精确到某一条」而不是「整个文件放行」——
 *    整文件放行会让以后往那个文件里新增的真文案也悄悄漏过去，
 *    而这份名单本来就是为了「不放过」才存在的。
 *
 * ⚠️ 静态分析判断不出「某个字符串最终会进 console」——
 *    这三条是**传给 `resync()` / `rebuild()` 的 reason**，
 *    在函数体里只喂给 `console.log`（已逐条核对过）。
 */
const ALLOW = [
  { file: 'composables/useRealtime.js', text: '快照缺失:', why: 'resync() 的日志原因串，只进 console.log' },
  { file: 'composables/useRealtime.js', text: '退避重连', why: 'rebuild() 的日志原因串，只进 console.log' },
  { file: 'composables/useRealtime.js', text: '回到前台', why: 'rebuild() 的日志原因串，只进 console.log' },
]

const allowedFor = (rel, s) => ALLOW.find((a) => a.file === rel && s.includes(a.text))

let pass = 0, fail = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

/* ------------------------------------------------ 1. 扫引号里的中文 */

const files = []
;(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { walk(p); continue }
    if (!/\.(js|vue)$/.test(name)) continue
    if (SKIP_FILES.has(relative(SRC, p))) continue
    files.push(p)
  }
})(SRC)

/** 剥掉注释后，返回每行的「有效代码」。 */
function stripComments(lines) {
  const out = []
  let inBlock = false
  for (const raw of lines) {
    let line = raw
    if (inBlock) {
      const end = line.indexOf('*/')
      if (end < 0) { out.push(''); continue }
      line = line.slice(end + 2)
      inBlock = false
    }
    line = line.replace(/\/\*[\s\S]*?\*\//g, '')
    const bs = line.indexOf('/*')
    if (bs >= 0) { line = line.slice(0, bs); inBlock = true }
    line = line.replace(/\/\/.*$/, '').replace(/<!--[\s\S]*?-->/g, '')
    out.push(line)
  }
  return out
}

/**
 * 命中是不是落在「开发期语句」里。
 *
 * 从命中行**向上回看**，直到遇到一个明显结束上一句的行（`;` / `{` / `}` / 空行），
 * 把这段拼起来看有没有 console / Error。
 * 之所以要回看：多行字符串拼接（`console.warn(\n  '中文…' +\n  '中文…'\n)`）
 * 只有第一行带 `console.`，后面几行看着就是裸字符串。
 */
function inDevContext(code, idx) {
  const parts = [code[idx]]
  for (let i = idx - 1; i >= 0 && i >= idx - 6; i--) {
    const t = code[i].trim()
    parts.unshift(code[i])
    if (t === '' || t.endsWith(';') || t.endsWith('{') || t.endsWith('}')) break
  }
  return DEV_CTX.test(parts.join('\n'))
}

const hits = []
const waived = []
for (const f of files) {
  const rel = relative(SRC, f)
  if (DATA_FILES.has(rel)) continue
  const code = stripComments(readFileSync(f, 'utf8').split('\n'))
  code.forEach((line, i) => {
    const re = /(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g
    let m
    while ((m = re.exec(line))) {
      const s = m[2]
      if (!CJK.test(s) || s.trim().length < MIN_LEN) continue
      if (inDevContext(code, i)) continue
      const wa = allowedFor(rel, s)
      if (wa) { waived.push({ file: rel, line: i + 1, why: wa.why }); continue }
      hits.push({ file: rel, line: i + 1, text: s.slice(0, 70) })
    }
  })
}

console.log(`【1】扫了 ${files.length} 个文件，发现 ${hits.length} 处「引号里的中文」\n`)
for (const h of hits) console.log(`     ${h.file}:${h.line}  ${h.text}`)
if (hits.length) console.log('')
check(
  '源码里没有「该翻译但硬编码」的中文',
  hits.length === 0,
  `${hits.length} 处（见上）—— 要么搬进 i18n.js，要么加进本脚本的 DATA_FILES 并写明理由`,
)

// 放行项**要说出来**，不能静默 —— 静默放行等于没有守卫
console.log(`     另有 ${waived.length} 处按名单放行：`)
for (const w of waived) console.log(`       ${w.file}:${w.line}  （${w.why}）`)
console.log('')
check('放行名单里没有「已经不在源码里」的过期项',
  waived.length === ALLOW.length,
  `名单 ${ALLOW.length} 条，命中 ${waived.length} 条 —— 有失效项要删掉`)

/* ------------------------ 2. 交叉校验：动态拼的 key 也要存在 */

const zh = (await import(join(ROOT, 'src/data/i18n.js'))).messages

const clockSrc = readFileSync(join(SRC, 'composables/useClock.js'), 'utf8')
const wmoBlock = /const WMO_CODES = new Set\(\[([\s\S]*?)\]\)/.exec(clockSrc)
const wmoCodes = wmoBlock
  ? wmoBlock[1].split(',').map((s) => s.trim()).filter(Boolean)
  : []
console.log(`【2】useClock.js 里声明了 ${wmoCodes.length} 个 WMO 代码`)

const missingZh = wmoCodes.filter((c) => !(`weather.wmo.${c}` in zh.zh))
const missingEn = wmoCodes.filter((c) => !(`weather.wmo.${c}` in zh.en))
check('每个 WMO 代码都有中文 key', missingZh.length === 0, `缺：${missingZh.join(', ')}`)
check('每个 WMO 代码都有英文 key', missingEn.length === 0, `缺：${missingEn.join(', ')}`)
check('WMO 代码表非空（正则没匹配到说明写法变了）', wmoCodes.length > 0)

// 星期：date.wd.0..6 两侧都要有
const missingWd = []
for (let i = 0; i < 7; i++) {
  if (!(`date.wd.${i}` in zh.zh)) missingWd.push(`zh:date.wd.${i}`)
  if (!(`date.wd.${i}` in zh.en)) missingWd.push(`en:date.wd.${i}`)
}
check('date.wd.0..6 中英都齐', missingWd.length === 0, missingWd.join(', '))

console.log(`\n合计 ${pass} 通过 / ${fail} 失败`)
if (fail) console.log('失败项：\n  - ' + failures.join('\n  - '))
process.exit(fail ? 1 : 0)
