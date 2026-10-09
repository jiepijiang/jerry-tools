/**
 * recover-from-transcript.mjs —— 从**会话记录**里把脚本捞回来。
 *
 * 为什么需要它
 * ------------
 * 探针原来住在 `/tmp/jerry-sb/`，被系统按文件清理掉了十几个
 * （`reset-default` / `transfer-cloud` / `route-guard` / `feedback-flow` …）。
 * 当时以为只能重写 —— 直到发现：
 *
 *   **`~/.workbuddy-ai/projects/<项目>/<会话id>.jsonl` 里存着每次
 *   `Write` / `Edit` 的完整调用参数。**
 *
 * 于是「探针丢了」是假命题：原文都在，只是不在文件系统上。
 *
 * 原理
 * ----
 * 对同一个路径，按出现顺序「**先 Write 铺底，再逐条 apply Edit**」即可还原。
 *
 * ⚠️ 恢复的边界（别当万能的）
 * --------------------------
 * - **只覆盖 Write / Edit。** 用 `sed` / 内联 python 改过的文件，
 *   那部分改动**不在记录里**，恢复出来会缺一块。
 * - **Edit 回放可能失真。** 如果某条 Edit 的 `old_string` 找不到，
 *   说明它前面那条 Edit 已经动过同一段 —— 本脚本会**打警告**而不是静默跳过。
 *   报过警告的文件**恢复出来的可能是中间态，用之前必须跑一遍验证**。
 * - **记录会被轮转/裁剪。** 更早的会话如果被清了就真没了。
 *   所以该进仓库的东西**还是要进仓库**，这个脚本只是最后一道保险。
 *
 * 用法
 * ----
 *   node scripts/recover-from-transcript.mjs --list
 *   node scripts/recover-from-transcript.mjs --list --filter jerry-sb
 *   node scripts/recover-from-transcript.mjs --dump <记录里的路径> <输出文件>
 *   node scripts/recover-from-transcript.mjs --dump-all <输出目录> --filter jerry-sb
 *
 * 不传 `--filter` 时默认只列 `/tmp/` 下的（也就是「本来就不该是唯一副本」的那批）。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

const PROJECTS = join(homedir(), '.workbuddy-ai', 'projects')

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : null
}
const has = (name) => argv.includes(name)
const FILTER = flag('--filter')

/** 收集所有会话记录（含 subagents）。 */
function transcripts() {
  if (!existsSync(PROJECTS)) return []
  const out = []
  for (const proj of readdirSync(PROJECTS)) {
    const dir = join(PROJECTS, proj)
    if (!statSync(dir).isDirectory()) continue
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.jsonl')) out.push(join(dir, f))
    }
    // subagents/
    const sub = join(dir, 'subagents')
    if (existsSync(sub)) {
      for (const f of readdirSync(sub)) if (f.endsWith('.jsonl')) out.push(join(sub, f))
    }
  }
  return out
}

/** 递归收集工具调用：返回 [ {tool, input}, … ] */
function collectCalls(node, out) {
  if (Array.isArray(node)) {
    for (const v of node) collectCalls(v, out)
    return
  }
  if (!node || typeof node !== 'object') return

  const name = node.name
  if (name === 'Write' || name === 'Edit' || name === 'MultiEdit') {
    let inp = node.input ?? node.arguments ?? null
    if (typeof inp === 'string') {
      try {
        inp = JSON.parse(inp)
      } catch {
        inp = null
      }
    }
    if (inp && typeof inp === 'object') out.push({ tool: name, input: inp })
  }
  for (const v of Object.values(node)) collectCalls(v, out)
}

/** { 路径: [ {tool, input}, … ] }，按出现顺序 */
function buildIndex() {
  const ops = new Map()
  for (const tp of transcripts()) {
    let raw
    try {
      raw = readFileSync(tp, 'utf8')
    } catch {
      continue
    }
    for (const line of raw.split('\n')) {
      if (!line.includes('"name":"Write"') && !line.includes('"name":"Edit"')) continue
      let obj
      try {
        obj = JSON.parse(line)
      } catch {
        continue
      }
      const calls = []
      collectCalls(obj, calls)
      for (const { tool, input } of calls) {
        const fp = input.file_path ?? input.filePath
        if (!fp) continue
        if (!ops.has(fp)) ops.set(fp, [])
        ops.get(fp).push({ tool, input })
      }
    }
  }
  return ops
}

/** 回放 Write + Edit → 最终内容；顺带返回失真警告数 */
function rebuild(entries) {
  let text = null
  let drift = 0
  for (const { tool, input } of entries) {
    if (tool === 'Write') {
      text = input.content ?? ''
      continue
    }
    if (text == null) return { text: null, drift }
    const edits = tool === 'MultiEdit' ? input.edits || [] : [input]
    for (const e of edits) {
      const oldS = e.old_string ?? ''
      const newS = e.new_string ?? ''
      if (!text.includes(oldS)) {
        drift++ // 前一条 Edit 已经动过这段 —— 回放会失真，必须报出来
        continue
      }
      text = text.replace(oldS, newS)
    }
  }
  return { text, drift }
}

const ops = buildIndex()
let targets = [...ops.keys()]
if (FILTER) targets = targets.filter((p) => p.includes(String(FILTER)))
else targets = targets.filter((p) => p.startsWith('/tmp/'))
targets.sort()

if (has('--list')) {
  console.log(`可恢复文件：${targets.length} 个${FILTER ? `（filter=${FILTER}）` : '（默认只列 /tmp/ 下的）'}\n`)
  for (const p of targets) {
    const entries = ops.get(p)
    const w = entries.filter((e) => e.tool === 'Write').length
    const e = entries.length - w
    const { text, drift } = rebuild(entries)
    const size = text == null ? 0 : Buffer.byteLength(text)
    const warn = text == null ? '  ⚠️ 回放失败（没有 Write 铺底）' : drift ? `  ⚠️ ${drift} 条 Edit 对不上，可能是中间态` : ''
    console.log(`  ${String(size).padStart(7)} B  Write×${w} Edit×${e}  ${basename(p)}${warn}`)
  }
  process.exit(0)
}

if (has('--dump')) {
  const src = flag('--dump')
  const dest = argv[argv.indexOf('--dump') + 2]
  if (!ops.has(src)) {
    console.error(`❌ 记录里没有 ${src}`)
    process.exit(1)
  }
  const { text, drift } = rebuild(ops.get(src))
  if (text == null) {
    console.error('❌ 回放失败：这个路径只有 Edit、没有 Write 铺底')
    process.exit(1)
  }
  writeFileSync(dest, text)
  console.log(`✅ 还原 ${Buffer.byteLength(text)} B → ${dest}${drift ? `（⚠️ ${drift} 条 Edit 对不上，务必验证）` : ''}`)
  process.exit(0)
}

if (has('--dump-all')) {
  const outdir = flag('--dump-all')
  mkdirSync(outdir, { recursive: true })
  let ok = 0
  let bad = 0
  let driftFiles = []
  for (const p of targets) {
    const { text, drift } = rebuild(ops.get(p))
    if (text == null) {
      bad++
      console.log(`  ❌ ${basename(p)}（没有 Write 铺底）`)
      continue
    }
    writeFileSync(join(outdir, basename(p)), text)
    ok++
    if (drift) driftFiles.push(`${basename(p)}(×${drift})`)
  }
  console.log(`\n还原 ${ok} 个，失败 ${bad} 个 → ${outdir}`)
  if (driftFiles.length) {
    console.log(`⚠️ 这些文件的 Edit 有对不上的，可能是中间态，用前必须验证：`)
    console.log('  ' + driftFiles.join(' · '))
  }
  process.exit(0)
}

console.log(readFileSync(new URL(import.meta.url)).toString().split('*/')[0].replace(/^\/\*\*?/, ''))
