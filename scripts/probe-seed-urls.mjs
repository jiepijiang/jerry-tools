/* =========================================================================
   探测候选书签：站点可达性 + 图标来源

   为什么必须先探：seed.js 里写死的 icon 一旦失效，卡片上就只剩首字母。
   项目既有判据（见 seed.js 头部）：
     · 能拿到高清图标的直接写死；
     · 拿不到的**留空**，由 faviconOf() 退回站点自己的 /favicon.ico；
     · **Cloudflare 反爬拦截不算失效**。

   用法：node probe-seed-urls.mjs [--proxy http://127.0.0.1:7897]
   ========================================================================= */

const PROXY = (() => {
  const i = process.argv.indexOf('--proxy')
  return i > -1 ? process.argv[i + 1] : ''
})()

const CANDIDATES = {
  ai: [
    ['DeepSeek', 'https://chat.deepseek.com'],
    ['Kimi', 'https://www.kimi.com'],
    ['豆包', 'https://www.doubao.com'],
    ['Perplexity', 'https://www.perplexity.ai'],
    ['Hugging Face', 'https://huggingface.co'],
    ['Ollama', 'https://ollama.com'],
  ],
  frontend: [
    ['MDN Web Docs', 'https://developer.mozilla.org'],
    ['Can I use', 'https://caniuse.com'],
    ['Vue.js', 'https://vuejs.org'],
    ['React', 'https://react.dev'],
    ['Vite', 'https://vite.dev'],
    ['Tailwind CSS', 'https://tailwindcss.com'],
  ],
  backend: [
    ['GitHub', 'https://github.com'],
    ['Stack Overflow', 'https://stackoverflow.com'],
    ['PostgreSQL', 'https://www.postgresql.org'],
    ['Redis', 'https://redis.io'],
    ['Docker', 'https://www.docker.com'],
    ['Supabase', 'https://supabase.com'],
  ],
  ui: [
    ['Figma', 'https://www.figma.com'],
    ['Dribbble', 'https://dribbble.com'],
    ['Unsplash', 'https://unsplash.com'],
    ['Coolors', 'https://coolors.co'],
    ['阿里巴巴矢量图标库', 'https://www.iconfont.cn'],
    ['花瓣网', 'https://huaban.com'],
  ],
  tools: [
    ['Notion', 'https://www.notion.so'],
    ['Excalidraw', 'https://excalidraw.com'],
    ['PDF24 Tools', 'https://tools.pdf24.org/zh/'],
    ['TinyPNG', 'https://tinypng.com'],
    ['regex101', 'https://regex101.com'],
    ['串口助手', 'https://serial.xywml.com/'],
  ],
  learn: [
    ['掘金', 'https://juejin.cn'],
    ['Coursera', 'https://www.coursera.org'],
    ['阮一峰的网络日志', 'https://www.ruanyifeng.com/blog/'],
    ['freeCodeCamp', 'https://www.freecodecamp.org'],
    ['Agent Lab', 'https://ai-study-exam.onrender.com/'],
    ['菜鸟教程', 'https://www.runoob.com'],
  ],
  resource: [
    ['npm', 'https://www.npmjs.com'],
    ['Google Fonts', 'https://fonts.google.com'],
    ['Iconify', 'https://icon-sets.iconify.design'],
    ['cdnjs', 'https://cdnjs.com'],
    ['unDraw', 'https://undraw.co'],
    ['Lorem Picsum', 'https://picsum.photos'],
  ],
  media: [
    ['YouTube', 'https://www.youtube.com'],
    ['哔哩哔哩', 'https://www.bilibili.com'],
    ['Spotify', 'https://www.spotify.com'],
    ['知乎', 'https://www.zhihu.com'],
    ['豆瓣', 'https://www.douban.com'],
    ['Steam', 'https://store.steampowered.com'],
  ],
}

/* Chromium 那套「不继承系统代理」在这里也适用：Node 的 fetch 默认直连，
   要走代理得显式加 dispatcher。这里用最土也最稳的办法 —— 环境变量 + undici。 */
const { ProxyAgent, setGlobalDispatcher } = await import('undici').catch(() => ({}))
if (PROXY && ProxyAgent) setGlobalDispatcher(new ProxyAgent(PROXY))

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'

async function probe(url, { method = 'GET', timeout = 12000 } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  const t0 = Date.now()
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'user-agent': UA, accept: '*/*' },
    })
    let len = res.headers.get('content-length')
    if (!len && method === 'GET') {
      try { len = String((await res.arrayBuffer()).byteLength) } catch { /* 忽略 */ }
    }
    return { ok: true, status: res.status, type: res.headers.get('content-type') || '', len, ms: Date.now() - t0 }
  } catch (e) {
    return { ok: false, status: 0, err: String(e.cause?.code || e.name || e.message).slice(0, 40), ms: Date.now() - t0 }
  } finally {
    clearTimeout(timer)
  }
}

const origin = (u) => new URL(u).origin

console.log(`代理：${PROXY || '（直连）'}\n`)
const rows = []
for (const [dim, list] of Object.entries(CANDIDATES)) {
  console.log(`\n=== ${dim} ===`)
  for (const [name, url] of list) {
    const site = await probe(url)
    // 图标候选：apple-touch-icon（高清）优先，再退 favicon.ico
    const iconCandidates = [`${origin(url)}/apple-touch-icon.png`, `${origin(url)}/favicon.ico`]
    const icons = []
    for (const ic of iconCandidates) {
      const r = await probe(ic)
      icons.push({ url: ic, status: r.status, type: r.type, len: r.len })
    }
    const good = icons.find((i) => i.status === 200 && (i.type.includes('image') || i.type.includes('icon') || i.type.includes('svg')))
    rows.push({ dim, name, url, site: site.status, siteErr: site.err, ms: site.ms, icon: good ? good.url : '', iconLen: good?.len, iconAlt: icons })
    console.log(
      `  ${site.status || site.err}  ${name.padEnd(20)} ${url}` +
        (good ? `   icon→ ${good.url.replace(origin(url), '')} (${good.len ?? '?'}B, ${good.type})` : '   icon→ 留空'),
    )
  }
}

console.log('\n\n===== 汇总：建议写死的 icon =====')
for (const r of rows) {
  if (r.icon) console.log(`  ${r.dim}/${r.name}: '${r.icon}'`)
}
console.log('\n===== 站点非 200 的 =====')
for (const r of rows) {
  if (r.site !== 200) console.log(`  ${r.dim}/${r.name}: ${r.site || r.siteErr}  ${r.url}`)
}

const { writeFileSync } = await import('node:fs')
writeFileSync('/tmp/probe-seed-urls.json', JSON.stringify(rows, null, 2))
console.log('\n明细已写 /tmp/probe-seed-urls.json')
