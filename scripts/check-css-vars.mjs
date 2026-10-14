#!/usr/bin/env node
/**
 * CSS 变量引用守卫。
 * ---------------------------------------------------------------------------
 * ## 为什么需要它
 *
 * `var(--x)` 引用一个**不存在的**变量时，浏览器**不报错**：
 * 整条声明被判定为无效值 → 直接丢弃。控制台干净、构建通过、
 * 页面正常渲染 —— 只是那条样式**没生效**。
 *
 * 2026-10-14 加书签图标选择器时实测撞上：我写了 `var(--text_color)`，
 * 而项目里叫 `--main_text_color`。那一行 `color` 静默失效，
 * 页面看不出任何异常。顺手扫全项目，又扫出 7 处 `var(--shadow-color)`
 * （真名是 `--shadow_color`，下划线）—— **7 个元素的 box-shadow 一直是空的**，
 * 谁也没发现，因为它不报错。
 *
 * ## 判据分两档（这是本脚本的关键设计）
 *
 *   ❌ **没有兜底值** → 整条声明失效 → **失败**
 *      `color: var(--text_color)`
 *
 *   ℹ️ **带兜底值** → 会渲染成兜底值，是有意为之的降级 → **只提示**
 *      `border-radius: var(--radius-md, 10px)`
 *
 * 把两档混为一谈的话，要么放过真故障，要么对着一堆「本来就写了兜底」的地方
 * 天天报红 —— 报红多了就没人看了。
 *
 * ## 运行时注入的变量要显式登记
 *
 * `--cols` / `--tip-shift` 这类**由 JS 用 `style.setProperty` 或 `:style` 注入**的
 * 变量，静态扫描必然找不到定义。它们不是漏网，是另一套机制 ——
 * 所以放进 `RUNTIME_SET` 白名单，**每条都要写清楚谁在设它**。
 *
 * 用法：node scripts/check-css-vars.mjs   （退出码 1 = 有硬故障）
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')

/**
 * 由 JS 在运行时设置的变量。**每条都要写清楚出处**，
 * 不然这份名单会变成「把碍事的都塞进来」的地方。
 */
const RUNTIME_SET = new Map([
  ['--cols', 'HomeView / ShareView 用 :style="{ \'--cols\': settings.perRow }" 注入网格列数'],
  ['--tip-shift', 'BookmarkCard 的 clampTooltip() 用 style.setProperty() 写入，把提示框夹回视口内'],
])

/* ------------------------------------------------------------------ */

const files = []
;(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(vue|css|js)$/.test(name)) files.push(p)
  }
})(SRC)

/** 定义：`--x:`（CSS 规则里，或 JS 里的 `'--x': value`）。 */
const DEFINED = /(--[\w-]+)\s*:/g
/** 引用：`var(` 之后紧跟的变量名。 */
const USED = /var\(\s*(--[\w-]+)/g

const defined = new Set()
const usages = [] // { name, file, line, hasFallback }

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const rel = relative(ROOT, file)
  const lines = text.split('\n')

  for (const m of text.matchAll(DEFINED)) defined.add(m[1])

  lines.forEach((line, i) => {
    for (const m of line.matchAll(USED)) {
      usages.push({ name: m[1], file: rel, line: i + 1, hasFallback: hasFallback(line, m.index + m[0].length) })
    }
  })
}

/**
 * 从 `var(` 的变量名之后往后扫，判断这个 `var()` 里有没有**顶层**逗号。
 *
 * ⚠️ 不能直接找逗号 —— `var(--x, rgb(0, 0, 0))` 的逗号在括号里，
 *    那是兜底值**内部**的逗号，不代表有兜底。所以要数括号深度。
 */
function hasFallback(line, from) {
  let depth = 0
  for (let i = from; i < line.length; i++) {
    const c = line[i]
    if (c === '(') depth++
    else if (c === ')') {
      if (depth === 0) return false // var() 收尾，全程没见到顶层逗号
      depth--
    } else if (c === ',' && depth === 0) return true
  }
  return false // 这一行没闭合，交给下一行 —— 实际写不下这种，保守当没有
}

/* ------------------------------------------------------------------ */

const missing = usages.filter((u) => !defined.has(u.name) && !RUNTIME_SET.has(u.name))
const hard = missing.filter((u) => !u.hasFallback)
const soft = missing.filter((u) => u.hasFallback)

const group = (list) => {
  const byName = new Map()
  for (const u of list) {
    if (!byName.has(u.name)) byName.set(u.name, [])
    byName.get(u.name).push(`${u.file}:${u.line}`)
  }
  return [...byName.entries()].sort((a, b) => b[1].length - a[1].length)
}

console.log(`扫描 ${files.length} 个文件：定义 ${defined.size} 个变量 / 引用 ${usages.length} 处`)

if (soft.length) {
  console.log(`\nℹ️  ${soft.length} 处引用了未定义的变量，但**写了兜底值**（会渲染成兜底，不是故障）：`)
  for (const [name, where] of group(soft)) {
    console.log(`   · ${name}  ← ${where.join(', ')}`)
  }
}

if (hard.length) {
  console.log(`\n❌ ${hard.length} 处引用了未定义的变量，且**没有兜底值** —— 这些声明整条失效：`)
  for (const [name, where] of group(hard)) {
    console.log(`   · ${name}  ← ${where.join(', ')}`)
  }
  console.log('\n   多半是拼写不一致（`--shadow-color` vs `--shadow_color` 这种）。')
  console.log('   改法：统一到实际定义的那个名字，或补一个兜底值 var(--x, 兜底)。')
  console.log(`\n❌ CSS 变量有 ${hard.length} 处硬故障。`)
  process.exit(1)
}

console.log('\n✅ 所有引用的 CSS 变量都有定义（或有兜底值）')
