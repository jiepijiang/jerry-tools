/* =========================================================================
   站点图标解析（异步部分）—— 真的去读页面的 `<head>`
   -------------------------------------------------------------------------
   `helpers.js` 的 `faviconOf()` 只会**猜** `<origin>/favicon.ico`。
   对现在的站点来说这个猜法经常是错的（尤其 GitHub Pages 项目站：
   域名根的 `/favicon.ico` 是**别人家**的图）。浏览器不是猜的 ——
   它下载 HTML、读 `<link rel="icon">`。这里做的是同一件事。

   纯函数 `extractIconHref()` 在 `helpers.js` 里（要能被 CI 探针直接 import）；
   本文件只负责「发请求 + 缓存」这部分，是浏览器专属的。

   ── 三个必须知道的约束 ────────────────────────────────────────────

   【CORS】跨域 `fetch` 拿不到 HTML 的站点，这里**静默返回空**。
     于是它会回落到 `/favicon.ico`（老行为）—— 不是「坏了」，是「读不到」。
     实测 GitHub Pages 的 HTML 带 `access-control-allow-origin: *`，
     所以本站（四站互链全是 Pages）这条链路是通的。

   【体积】只读到 `</head>` 或 256KB 为止，**不把整页下完**。
     图标声明永远在 head 里；一个 5MB 的页面没理由为了一张 32px 的图全下载。
     用 `reader.cancel()` 主动掐断，不是「读完再截」。

   【超时】5 秒。这是**用户正在等**的路径（弹窗预览），不能无限挂着。

   ── 缓存策略 ──────────────────────────────────────────────────────

   同一个 URL 在一次会话里最多发一次请求：
     · 成功的（拿到了地址）**永久缓存**；
     · 失败的（没声明 / 没 CORS / 超时）只缓存 60 秒 ——
       否则一次网络抖动会把某个站点在这一整次会话里钉死成「没图标」。
   ========================================================================= */

import { extractIconHref, normalizeUrl } from '@/utils/helpers'

/** 单次请求的上限。弹窗预览在等它，不能长。 */
const TIMEOUT_MS = 5000

/** 最多读这么多字节（或读到 `</head>`，谁先到算谁）。 */
const MAX_BYTES = 256 * 1024

/** 失败结果的缓存时长。见文件头「缓存策略」。 */
const NEGATIVE_TTL_MS = 60_000

/** url → { at, value } */
const CACHE = new Map()
/** url → Promise<string>，同一个 url 并发只发一次请求 */
const PENDING = new Map()

/**
 * 读一个 URL 的「站点声明图标」，读不到返回 `''`。**永不抛错。**
 *
 * @param {string} pageUrl 书签网址（`github.com` 这种缺协议的也认）
 * @returns {Promise<string>} 绝对地址；`''` = 没解析到
 */
export async function resolveSiteIcon(pageUrl) {
  const target = normalizeUrl(pageUrl)
  if (!target) return ''

  const hit = CACHE.get(target)
  if (hit && (hit.value || Date.now() - hit.at < NEGATIVE_TTL_MS)) return hit.value

  const inflight = PENDING.get(target)
  if (inflight) return inflight

  const p = fetchIconHref(target)
    .then((value) => {
      CACHE.set(target, { at: Date.now(), value })
      return value
    })
    .finally(() => PENDING.delete(target))

  PENDING.set(target, p)
  return p
}

/** 清空缓存。**只给测试用** —— 生产代码里没有「重新解析一次」的语义。 */
export function clearSiteIconCache() {
  CACHE.clear()
  PENDING.clear()
}

/* ------------------------------------------------------------------ 内部 */

async function fetchIconHref(url) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    /*
     * ⚠️ 不设任何自定义请求头。`Accept` 虽然在 CORS 安全名单里，
     *    但没必要的头就是没必要的风险 —— 一旦触发预检，
     *    大量站点会因为没处理 OPTIONS 而直接失败。
     */
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      credentials: 'omit',
    })
    if (!res.ok) return ''
    const html = await readHead(res)
    /*
     * ⚠️ 用 `res.url` 而不是 `url` 作基准：站点 301 到别处是常态
     *    （`http://x.com` → `https://www.x.com/`），相对路径得按**最终地址**解析。
     */
    return extractIconHref(html, res.url || url)
  } catch {
    /* 网络错误 / 超时 / 无 CORS —— 一律当作「读不到」，让调用方走兜底 */
    return ''
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 只读到 `</head>`（或 `MAX_BYTES`）就停。
 *
 * ⚠️ 按**字节**累加而不是按解码后的字符数 —— 字符数会因为多字节字符
 *    比实际下载量小，导致在中文页面上多下好几倍。
 */
async function readHead(res) {
  if (!res.body?.getReader) {
    // 没有流式 body 的环境（极老浏览器）：退回整体读，再截
    return (await res.text()).slice(0, MAX_BYTES)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let out = ''
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      out += decoder.decode(value, { stream: true })
      if (bytes >= MAX_BYTES || /<\/head\s*>/i.test(out)) break
    }
  } catch {
    /* 读到一半断了也认 —— 前面拿到的 head 通常已经够用 */
  } finally {
    // 主动掐断剩余下载。失败无所谓，别让 finally 抛出去
    try {
      await reader.cancel()
    } catch {
      /* ignore */
    }
  }
  return out
}
