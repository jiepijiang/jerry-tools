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

   两层：

   1. **内存**（本次会话）：同一个 URL 最多发一次请求
        · 成功的（拿到了地址）**永久缓存**；
        · 失败的（没声明 / 没 CORS / 超时）只缓存 60 秒 ——
          否则一次网络抖动会把某个站点在这一整次会话里钉死成「没图标」。

   2. **localStorage**（跨会话，2026-10-26 加）：失败结果记 24 小时
        · 为什么需要：第 1 层刷新就忘，而 CORS 拦截是**确定性**的 ——
          不带 `access-control-allow-origin` 的站点每次刷新都必然失败一次，
          console 里就是一片红字。实测首页每次加载 5 条。
        · 为什么是 24 小时：`TypeError: Failed to fetch` **区分不了**
          「CORS 拦截」和「网络断开」，TTL 太长会把临时故障的站点钉死。
        · 只记失败；成功的结果已经写进书签的 `icon` 字段了。
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

/* ── 失败结果的**跨会话**缓存 ────────────────────────────────────────
 *
 * 为什么需要：上面 `CACHE` 的 60 秒只活在一次会话里，**刷新就忘**。
 * 而有些站点是**确定性**解析不到的 —— 最典型的是不带
 * `access-control-allow-origin` 的站点（抽样 8 个常见站点 0 个带），
 * 跨域 `fetch` 一律被浏览器拦掉。
 *
 * 后果（2026-10-26 实测）：每次打开首页，`backfillIconSrc` 都会为
 * seed 里那几条留空的条目重发请求，浏览器在 console 打一片
 * 「blocked by CORS policy」红字 —— **每次刷新都打**，登录页也一样。
 *
 * ⚠️ 区分不了「CORS 拦截」和「网络断开」—— 两者在 JS 里都是
 *    `TypeError: Failed to fetch`。所以 TTL 不能太长：一次断网不该把
 *    某个站点钉死一星期。24 小时是折中 —— 确定性失败的站点每天最多重试一次。
 *
 * ⚠️ 只记「失败」。成功的地址本来就写进了书签的 `icon` 字段（回填），
 *    不需要在这里再存一份。
 */
const MISS_KEY = 'jt:iconMiss'
const MISS_TTL_MS = 24 * 60 * 60 * 1000
/** 上限。超出按时间戳删最老的 —— 防止 localStorage 被无限撑大。 */
const MISS_LIMIT = 400

/** 懒加载的镜像，避免每次解析都 `JSON.parse` 一遍。 */
let MISS = null

function misses() {
  if (MISS) return MISS
  try {
    const raw = localStorage.getItem(MISS_KEY)
    const obj = raw ? JSON.parse(raw) : {}
    MISS = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {}
  } catch {
    /* 没有 localStorage（SSR / 隐私模式）或内容坏了 —— 退化成不持久化 */
    MISS = {}
  }
  return MISS
}

function persistMisses() {
  try {
    localStorage.setItem(MISS_KEY, JSON.stringify(MISS))
  } catch {
    /* 配额满 / 隐私模式：功能不受影响，只是下次会话会重试 */
  }
}

function isKnownMiss(url) {
  const at = misses()[url]
  return typeof at === 'number' && Date.now() - at < MISS_TTL_MS
}

function markMiss(url) {
  const m = misses()
  m[url] = Date.now()
  const keys = Object.keys(m)
  if (keys.length > MISS_LIMIT) {
    keys.sort((a, b) => m[a] - m[b])
    for (const k of keys.slice(0, keys.length - MISS_LIMIT)) delete m[k]
  }
  persistMisses()
}

function clearMiss(url) {
  const m = misses()
  if (!(url in m)) return
  delete m[url]
  persistMisses()
}

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

  // 上次（跨会话）就解析不到 → **不再发请求**。见 MISS_KEY 那段注释。
  if (isKnownMiss(target)) return ''

  const inflight = PENDING.get(target)
  if (inflight) return inflight

  const p = fetchIconHref(target)
    .then((value) => {
      CACHE.set(target, { at: Date.now(), value })
      if (value) clearMiss(target)
      else markMiss(target)
      return value
    })
    .finally(() => PENDING.delete(target))

  PENDING.set(target, p)
  return p
}

/** 清空缓存（内存 + 跨会话的失败记录）。**只给测试用** —— 生产代码里没有「重新解析一次」的语义。 */
export function clearSiteIconCache() {
  CACHE.clear()
  PENDING.clear()
  MISS = null
  try {
    localStorage.removeItem(MISS_KEY)
  } catch {
    /* 没有 localStorage —— 本来就没存 */
  }
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
