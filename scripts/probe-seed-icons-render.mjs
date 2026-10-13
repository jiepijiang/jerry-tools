/* =========================================================================
   probe-seed-icons-render.mjs —— 种子里的图标**在浏览器里真的能显示吗**

   🔴 为什么必须有这一条（2026-10-13 的教训）：
      `probe-seed-urls.mjs` 和 `probe-seed-icons.mjs` 都只看 HTTP 层
      （状态码 + `content-type`），两个都全绿 —— 但在真浏览器里一跑，
      **48 个图标有 7 个加载不出来**。

      原因分两类：
        · 6 个是沙箱网络到不了（Perplexity / Hugging Face / YouTube /
          Spotify / Steam / Docker）—— 换对路径或走代理就好；
        · 1 个是**站点自己的缺陷**：花瓣网的 `/favicon.ico` 返回结构损坏的
          ICO，HTTP 200 但 Chromium 拒绝解码，**连 `requestfailed` 都不触发**
          （所以只监听网络事件也抓不到，必须读 `naturalWidth`）。

      📌 **「HTTP 200 + image/png」和「浏览器画得出来」是两件事。**
         验图片要看 `naturalWidth > 0`，不能看状态码。

   用法：
     node scripts/probe-seed-icons-render.mjs [--proxy http://127.0.0.1:7897]

   ⚠️ 不带 `--proxy` 时，被墙的站点（YouTube / Spotify / Steam / Perplexity /
      Hugging Face / Docker）必然失败 —— 那是**沙箱网络**问题，不是 URL 坏了。
      判定：失败项走代理后能过 → 网络问题；仍失败 → URL 真有问题。
   ========================================================================= */

import pw from './lib/playwright.mjs'
import { seedBookmarks } from '../src/data/seed.js'

const i = process.argv.indexOf('--proxy')
const PROXY = i > -1 ? process.argv[i + 1] : ''

const browser = await pw.chromium.launch(PROXY ? { proxy: { server: PROXY } } : {})
const page = await browser.newPage()

const withIcon = seedBookmarks.filter((b) => b.icon)
const urls = [...new Set(withIcon.map((b) => b.icon))]

const res = await page.evaluate(async (list) => {
  const out = []
  for (const u of list) {
    const r = await new Promise((resolve) => {
      const img = new Image()
      const t = setTimeout(() => resolve({ ok: false, why: 'timeout' }), 15000)
      img.onload = () => {
        clearTimeout(t)
        // ⚠️ onload 也可能给出 0x0（解码失败），所以还要看 naturalWidth
        resolve({ ok: img.naturalWidth > 0, w: img.naturalWidth, h: img.naturalHeight, why: img.naturalWidth ? '' : 'zero-size' })
      }
      img.onerror = () => {
        clearTimeout(t)
        resolve({ ok: false, why: 'onerror' })
      }
      img.src = u
    })
    out.push({ u, ...r })
  }
  return out
}, urls)

const bad = res.filter((r) => !r.ok)
const nameOf = (u) => withIcon.find((b) => b.icon === u)?.name || '?'

console.log(`\n代理：${PROXY || '（直连）'}`)
console.log(`种子 ${seedBookmarks.length} 条，带图标 ${withIcon.length} 条（去重后 ${urls.length} 个 URL）\n`)
for (const r of res) {
  console.log(`  ${r.ok ? '✓' : '✗'} ${(r.ok ? `${r.w}x${r.h}` : r.why).padEnd(11)} ${nameOf(r.u).padEnd(18)} ${r.u}`)
}

console.log('\n有意留空（走 faviconOf 回落，卡片显示首字母）：')
for (const b of seedBookmarks.filter((x) => !x.icon)) console.log(`  · ${b.name.padEnd(18)} ${b.url}`)

console.log(`\n可渲染 ${res.length - bad.length} / 失败 ${bad.length}`)
if (bad.length && !PROXY) {
  console.log('⚠️ 直连模式下失败是**预期**的（被墙站点）。加 --proxy 复测：')
  console.log('   node scripts/probe-seed-icons-render.mjs --proxy http://127.0.0.1:7897')
}

await browser.close()
process.exit(bad.length && PROXY ? 1 : 0)
