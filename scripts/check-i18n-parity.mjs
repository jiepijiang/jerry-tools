/* =========================================================================
   i18n 平铺校验（纯逻辑，不碰网络，所以任何一轮都该全绿）

   查四件事：
     1. 中英键集**完全一致**（漏一边 = 切语言时那句文案直接消失）
     2. 两个字典里都没有空值（空串会让 `t()` 返回空 → 界面上一块空白）
     3. **源码文本里没有重复键** —— 这一条 `import` 之后查不出来，
        JS 对象字面量遇到重复键是「后者胜、不报错」，所以必须读源码文本。
        （2026-09-29 真的踩到过：删 `common.reset` 时把上一行改成了
          `common.cancel`，于是 zh 里出现了两个 `common.cancel`，
          编译、渲染、其余探针全都毫无反应。）
     4. 代码里 `t('字面量')` 引用的键都存在（拼错一个字母就是空白）

   ⚠️ 第 4 条只认**字面量**。项目里有动态调用（`t(m.nameKey)`、
      `t(s.labelKey)`、`t(geo.error)`），所以**不能**反过来断言
      「字典里的键都被用到」—— 那会误报一堆。

   用法：node scripts/check-i18n-parity.mjs   （npm run check:i18n 会带上它）

   （原文件在 2026-09-29 被 /tmp 清理掉了，这是重建版。原来是 21 条，
     这里补上了第 3 条「重复键」的源码级检查。）
   ========================================================================= */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// ⚠️ 用**相对路径**导入，不用 `@/` 别名 —— 那样要挂 ESM loader 才能跑，
//    CI 里多一层依赖。（`src/data/i18n.js` 自己不 import 任何东西，能直接读。）
import { messages } from '../src/data/i18n.js'

// 仓库根目录由**脚本自己的位置**推出来 —— 别写死绝对路径，CI 里路径不一样。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const I18N_SRC = path.join(ROOT, 'src/data/i18n.js')

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

/* ------------------------------------------------ 1 / 2 键集与取值 */

const zhKeys = Object.keys(messages.zh)
const enKeys = Object.keys(messages.en)
const zhSet = new Set(zhKeys)
const enSet = new Set(enKeys)

const onlyZh = zhKeys.filter((k) => !enSet.has(k))
const onlyEn = enKeys.filter((k) => !zhSet.has(k))

console.log(`  字典：zh ${zhKeys.length} 个键 / en ${enKeys.length} 个键`)

check('中英键集完全一致', onlyZh.length === 0 && onlyEn.length === 0, `只有 zh：${JSON.stringify(onlyZh)}；只有 en：${JSON.stringify(onlyEn)}`)

const emptyZh = zhKeys.filter((k) => !String(messages.zh[k] ?? '').trim())
const emptyEn = enKeys.filter((k) => !String(messages.en[k] ?? '').trim())
check('zh 没有空值', emptyZh.length === 0, JSON.stringify(emptyZh))
check('en 没有空值', emptyEn.length === 0, JSON.stringify(emptyEn))

const nonString = [...zhKeys, ...enKeys].filter(
  (k) => typeof (messages.zh[k] ?? messages.en[k]) !== 'string',
)
check('所有取值都是字符串', nonString.length === 0, JSON.stringify(nonString.slice(0, 8)))

/* ------------------------------------------------ 3 源码文本里的重复键 */

const text = readFileSync(I18N_SRC, 'utf8')
const lines = text.split('\n')

/** 找出每个字典块的起止行号（`  zh: {` … 到下一个顶层 `  }`）。 */
function blockRange(name) {
  const start = lines.findIndex((l) => new RegExp(`^\\s{2}${name}:\\s*\\{`).test(l))
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') depth++
      else if (ch === '}') depth--
    }
    if (i > start && depth === 0) return [start, i]
  }
  return null
}

for (const lang of ['zh', 'en']) {
  const range = blockRange(lang)
  if (!range) {
    check(`${lang} 字典块能被定位到`, false, '没找到 `  ' + lang + ': {`')
    continue
  }
  const seen = new Map()
  const dups = []
  for (let i = range[0]; i <= range[1]; i++) {
    const m = lines[i].match(/^\s{4}'([^']+)':/)
    if (!m) continue
    if (seen.has(m[1])) dups.push(`${m[1]}（行 ${seen.get(m[1]) + 1} 与 ${i + 1}）`)
    else seen.set(m[1], i)
  }
  console.log(`  ${lang} 块：行 ${range[0] + 1}–${range[1] + 1}，文本里 ${seen.size} 个键`)
  check(`${lang} 源码里没有重复键`, dups.length === 0, dups.join('；'))
  check(`${lang} 源码键数与解析后一致`, seen.size === (lang === 'zh' ? zhKeys.length : enKeys.length), `文本 ${seen.size} ≠ 解析 ${lang === 'zh' ? zhKeys.length : enKeys.length}`)
}

/* ------------------------------------------------ 4 代码里引用的字面量键 */

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(js|vue)$/.test(name)) out.push(p)
  }
  return out
}

const files = walk(path.join(ROOT, 'src'))

/**
 * 剥掉注释再扫。
 *
 * ⚠️ 2026-10-02 补：以前是**直接在原文上正则**，于是**注释里写的 `t('…')`
 *    会被当成真实引用**。这次就是在 i18n.js 的注释里写了一句
 *    「parity 只扫 `t('…')` 的字面量」，守卫立刻报「引用了不存在的键 …」。
 *
 * 这类假阳性很坑：它指向的是「字典少了一个叫 … 的键」，
 * 而真相是**守卫读了自己不该读的地方**。
 */
function stripComments(src) {
  let inBlock = false
  return src
    .split('\n')
    .map((raw) => {
      let line = raw
      if (inBlock) {
        const end = line.indexOf('*/')
        if (end < 0) return ''
        line = line.slice(end + 2)
        inBlock = false
      }
      line = line.replace(/\/\*[\s\S]*?\*\//g, '')
      const bs = line.indexOf('/*')
      if (bs >= 0) { line = line.slice(0, bs); inBlock = true }
      return line.replace(/\/\/.*$/, '').replace(/<!--[\s\S]*?-->/g, '')
    })
    .join('\n')
}

const used = new Map() // key -> 出现次数
for (const f of files) {
  const src = stripComments(readFileSync(f, 'utf8'))
  for (const m of src.matchAll(/\bt\(\s*'([^']+)'\s*[,)]/g)) used.set(m[1], (used.get(m[1]) || 0) + 1)
  for (const m of src.matchAll(/\bt\(\s*"([^"]+)"\s*[,)]/g)) used.set(m[1], (used.get(m[1]) || 0) + 1)
}

const missing = [...used.keys()].filter((k) => !zhSet.has(k) || !enSet.has(k))
console.log(`  代码里引用了 ${used.size} 个字面量键（扫了 ${files.length} 个文件）`)
check('代码引用的字面量键都存在于字典里', missing.length === 0, JSON.stringify(missing))

/* 本次改动专门盯一下：新增的「恢复默认数据」那一组键必须真的被用上 */
for (const k of ['settings.resetGroup', 'settings.resetSettings', 'settings.resetData', 'settings.resetDataHint', 'toast.resetDataOk', 'toast.resetDataFail']) {
  check(`新键 ${k} 被界面引用`, used.has(k), `引用次数 ${used.get(k) || 0}`)
}

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / 失败 ${fail}`)
if (failures.length) console.log(`失败项（${failures.length}）：\n  - ${failures.join('\n  - ')}`)
console.log()
process.exit(fail ? 1 : 0)
