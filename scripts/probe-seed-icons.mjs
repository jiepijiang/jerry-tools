/* =========================================================================
   第二遍探测：从 HTML 的 <link rel="icon"> 里取**真实图标路径**

   为什么需要：不少站点的 `/favicon.ico` 是 404（Vue / Vite / Ollama / Notion…），
   真正在用的是 HTML 里声明的别的路径。`faviconOf()` 的兜底只会拼 `/favicon.ico`，
   所以这些站点必须**把真实路径写死**，否则卡片上只剩首字母。

   先例：seed.js 的 b23 Agent Lab —— `/favicon.ico` 是 404，
   真图标在 `/assets/favicon.svg`。

   用法：node probe-seed-icons.mjs [--proxy http://127.0.0.1:7897]
   ========================================================================= */

const CANDIDATES = [
  ['ai', 'DeepSeek', 'https://chat.deepseek.com'],
  ['ai', 'Kimi', 'https://www.kimi.com'],
  ['ai', '豆包', 'https://www.doubao.com'],
  ['ai', 'Ollama', 'https://ollama.com'],
  ['frontend', 'Can I use', 'https://caniuse.com'],
  ['frontend', 'Vue.js', 'https://vuejs.org'],
  ['frontend', 'Vite', 'https://vite.dev'],
  ['backend', 'Stack Overflow', 'https://stackoverflow.com'],
  ['backend', 'Supabase', 'https://supabase.com'],
  ['ui', 'Dribbble', 'https://dribbble.com'],
  ['ui', 'Coolors', 'https://coolors.co'],
  ['tools', 'Notion', 'https://www.notion.so'],
  ['tools', 'TinyPNG', 'https://tinypng.com'],
  ['learn', 'freeCodeCamp', 'https://www.freecodecamp.org'],
  ['learn', 'Agent Lab', 'https://ai-study-exam.onrender.com/'],
  ['resource', 'npm', 'https://www.npmjs.com'],
  ['resource', 'Google Fonts', 'https://fonts.google.com'],
  ['media', '哔哩哔哩', 'https://www.bilibili.com'],
]

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'

async function get(url) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'user-agent': UA, accept: 'text/html,image/*,*/*' },
    })
    const type = res.headers.get('content-type') || ''
    const buf = Buffer.from(await res.arrayBuffer())
    return { status: res.status, type, body: buf }
  } catch (e) {
    return { status: 0, type: '', body: Buffer.alloc(0), err: String(e.cause?.code || e.message) }
  } finally {
    clearTimeout(timer)
  }
}

/** 从 HTML 里抽出所有 rel 含 icon 的 href */
function extractIconLinks(html, base) {
  const out = []
  const re = /<link\b[^>]*>/gi
  for (const tag of html.match(re) || []) {
    if (!/rel\s*=\s*["']?[^"'>]*icon/i.test(tag)) continue
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (!href) continue
    const rel = /rel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || ''
    const sizes = /sizes\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || ''
    const type = /type\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || ''
    try {
      out.push({ url: new URL(href, base).href, rel, sizes, type })
    } catch { /* 忽略非法 href */ }
  }
  return out
}

const { writeFileSync } = await import('node:fs')
const report = []

for (const [dim, name, site] of CANDIDATES) {
  const page = await get(site)
  let links = []
  if (page.status === 200 && page.type.includes('html')) {
    links = extractIconLinks(page.body.toString('utf8'), site)
  }

  // 逐个验证候选图标的真实可用性（必须是 image/*，且不是 HTML 回退）
  const checked = []
  for (const l of links) {
    const r = await get(l.url)
    const usable = r.status === 200 && (r.type.startsWith('image/') || r.type.includes('icon'))
    checked.push({ ...l, status: r.status, ctype: r.type, bytes: r.body.length, usable })
  }

  // 挑最好的：优先 apple-touch / 大尺寸 / svg，且体积别太夸张
  const ok = checked.filter((c) => c.usable)
  const score = (c) =>
    (/apple-touch/i.test(c.rel) ? 100 : 0) +
    (/svg/i.test(c.type) || /\.svg/i.test(c.url) ? 40 : 0) +
    (Number(/(\d+)x\d+/.exec(c.sizes)?.[1]) || 0) +
    (c.bytes > 200 * 1024 ? -60 : 0) // 太大反而拖慢卡片
  const best = ok.sort((a, b) => score(b) - score(a))[0]

  report.push({ dim, name, site, pageStatus: page.status, pageErr: page.err, candidates: checked, best: best?.url || '' })

  console.log(`\n${dim} / ${name}   (页面 ${page.status || page.err})`)
  for (const c of checked) {
    console.log(`   ${c.usable ? '✓' : ' '} ${String(c.status).padEnd(4)} ${String(c.ctype).slice(0, 28).padEnd(30)} ${String(c.bytes).padStart(8)}B  ${c.url}`)
  }
  console.log(`   → 选中：${best?.url || '（无，只能留空）'}`)
}

console.log('\n\n===== 建议写死的 icon =====')
for (const r of report) {
  if (r.best) console.log(`  ${r.dim}/${r.name}: '${r.best}'`)
}
console.log('\n===== 仍然拿不到图标的 =====')
for (const r of report) {
  if (!r.best) console.log(`  ${r.dim}/${r.name}  (页面 ${r.pageStatus || r.pageErr})  ${r.site}`)
}

writeFileSync('/tmp/probe-seed-icons.json', JSON.stringify(report, null, 2))
console.log('\n明细已写 /tmp/probe-seed-icons.json')
