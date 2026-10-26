/* =========================================================================
   通用工具
   ========================================================================= */

/**
 * 静态资源路径前缀。
 *
 * GitHub Pages 把站点挂在 /<仓库名>/ 子路径下，写死的 '/static/...' 会 404。
 * Vite 只会重写 index.html 和 CSS 里的绝对路径，JS 里的字符串得自己加前缀。
 * 本地 dev 时 BASE_URL 就是 '/'，所以两种环境写法统一。
 *
 * 新增资源照抄这个写法即可：asset('static/img/xxx.png')
 */
export const asset = (path) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`

/** 生成短 id。 */
export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 深拷贝（纯 JSON 数据足够用）。 */
export const clone = (v) => JSON.parse(JSON.stringify(v))

/** 稳定的字符串哈希，给兜底图标挑颜色用。 */
export function hashString(str) {
  let h = 0
  const s = String(str || '')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

/** 取域名，用于展示与 favicon。 */
export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return String(url || '').replace(/^https?:\/\//, '').split('/')[0]
  }
}

/** 名称首字母（中文取第一个字），用于兜底图标。 */
export function initialOf(name) {
  const s = String(name || '').trim()
  if (!s) return '?'
  const m = s.match(/[A-Za-z0-9]/)
  return (m ? m[0] : s[0]).toUpperCase()
}

/** 校验 URL 是否合法。 */
export function isValidUrl(url) {
  const s = String(url || '').trim()
  if (!s) return false
  try {
    const u = new URL(/^https?:\/\//.test(s) ? s : `https://${s}`)
    return !!u.hostname && u.hostname.includes('.')
  } catch {
    return false
  }
}

/** 补全协议。 */
export function normalizeUrl(url) {
  const s = String(url || '').trim()
  if (!s) return ''
  return /^https?:\/\//.test(s) ? s : `https://${s}`
}

/**
 * 第三方 favicon 服务 —— 一律不用。
 *
 * 为什么不能图省事用它们：
 *   1. **国内不可达**。`icons.duckduckgo.com` / `t*.gstatic.com` 都够呛，
 *      一个不通就是**整页图标集体挂掉**，看着像站点坏了；
 *   2. **批量请求会被限流**，表现是「刷新几次之后图标全白」；
 *   3. **跟站点本身没关系**。站点换了图标这里不会跟着变，数据会慢慢腐烂。
 *
 * ⚠️ `www.gstatic.com` **不在**这个名单里 —— 那是 Google 自家站点的静态资源
 *    （AI Studio / Firebase / TensorFlow 的图标都从那儿发），
 *    是「站点自己的 CDN」而不是 favicon 服务。真正的服务是
 *    `t0-t3.gstatic.com/faviconV2`。同理 `cdn.prod.website-files.com`
 *    （Webflow 托管）也不算 —— 那是站点自己在用的。
 */
const THIRD_PARTY_ICON_HOSTS = new Set([
  'icons.duckduckgo.com',
  'icon.horse',
  'api.faviconkit.com',
  'favicon.im',
  't0.gstatic.com',
  't1.gstatic.com',
  't2.gstatic.com',
  't3.gstatic.com',
])

/** host 太宽、不能整域名拉黑的，按路径判断。 */
const THIRD_PARTY_ICON_PATHS = [
  { host: /^(www\.)?google\.com$/i, path: /^\/s2\/favicons\b/i },
]

/** 这个地址是不是「第三方 favicon 服务」。 */
export function isThirdPartyIcon(src) {
  let u
  try {
    u = new URL(String(src))
  } catch {
    return false
  }
  if (THIRD_PARTY_ICON_HOSTS.has(u.hostname.toLowerCase())) return true
  return THIRD_PARTY_ICON_PATHS.some((r) => r.host.test(u.hostname) && r.path.test(u.pathname))
}

/**
 * 这个**自定义**图标地址能不能真的拿来用。
 *
 * 允许：
 *   - `data:image/…` —— 用户自己上传的。⚠️ 2026-10-01 起上传改走
 *     `data/iconStorage.js` 的 `uploadImage()`，**登录后存的是 Storage 公开 URL**，
 *     只有未登录（纯本机模式）才回落 dataURL。所以这个分支现在只服务
 *     本机模式的老数据与老用户，但仍然必须保留。
 *   - 站内相对路径（`/static/…`、`./…`）
 *   - `https://` 且不是第三方 favicon 服务
 *
 * 拒绝：
 *   - 明文 `http://` —— HTTPS 页面上会被浏览器直接拦掉（Mixed Content），
 *     还会在控制台留一条警告。种子里那条 `http://regex101.com/…` 就是。
 *   - 第三方 favicon 服务（理由见上）
 *   - 空值 / 解析不出来的地址
 */
export function isUsableIcon(src) {
  const s = String(src || '').trim()
  if (!s) return false
  if (/^data:image\//i.test(s)) return true
  // 站内路径。⚠️ 排除 `//host/x`（协议相对地址）—— 那是外链，得走下面的 https 判断
  if (s.startsWith('/') && !s.startsWith('//')) return true
  if (s.startsWith('./') || s.startsWith('../')) return true
  if (!/^https:\/\//i.test(s)) return false
  return !isThirdPartyIcon(s)
}

/**
 * 站点图标地址。
 * 优先级：`custom` 参数（用户填的自定义图标 / **解析到的真图标地址**）→
 *        站点 origin 的 `/favicon.ico` → 由调用方渲染首字母兜底。
 *
 * 特意**不用** Google 的 s2 favicon 服务：它在国内不可达，会让整页图标集体挂掉，
 * 而且批量请求还会被限流。让每个站点自己提供图标，既没有第三方依赖也不会被限。
 *
 * ⚠️ `custom` 会被 `isUsableIcon()` 过一遍 —— 数据里躺着不合格的地址时
 *    **在这里回落到站点自己的图标**，而不是把坏地址丢给 `<img>`。
 *    这不是多余的：早期从参考站抄来的 377 条种子里就有 36 条指向
 *    duckduckgo / google s2、1 条是明文 http。指望数据永远干净不现实，
 *    而且线上库里那份改不动（要 service_role），只能在渲染这层挡住。
 *
 * ⚠️ 调用点要写成 `faviconOf(url, icon)`，**不要**写 `icon || faviconOf(url)` ——
 *    后者把自定义图标整个绕过去了，这条兜底逻辑一行都不会执行。
 *
 * ⚠️ 2026-10-14 起，**渲染书签**的调用点应该改用 `iconSrcFor(item)`（见下）——
 *    它多认一个 `iconMode` 字段，用来区分「用户明确选了首字母」和「没选」。
 *    本函数仍然是它的底座，直接调它的地方只剩发现页站点（那份数据没有 iconMode）。
 */
export function faviconOf(url, custom) {
  const c = String(custom || '').trim()
  if (isUsableIcon(c)) return c
  try {
    const host = new URL(normalizeUrl(url)).origin
    return `${host}/favicon.ico`
  } catch {
    return ''
  }
}

/**
 * 图标**加载失败**时的第二候选地址：站点 origin 的 `/favicon.ico`。
 *
 * 为什么需要：`isUsableIcon()` 只校验地址**格式**（https、非第三方），
 * 不校验**能不能加载**。数据里躺着格式合格但 404 的地址时
 * （站点改版、反爬、早期种子里抄错的路径），`<img>` 直接失败 → 字母块，
 * **哪怕这个站点自己的 `/favicon.ico` 明明是通的**。
 *
 * 返回 `''` = 「不值得再试」，三种情况：
 *   · `src` 为空 —— 压根没图；
 *   · `src` 本来就是那个兜底地址 —— 再试就是自己，会无限循环；
 *   · `pageUrl` 不是合法 URL —— 推导不出来，也不该瞎猜。
 *
 * ⚠️ 只返回**一个**候选，不负责重试。重试由 `BookmarkIcon` 管
 *    （它要知道「已经试过一次了」，那是组件状态，不是纯函数的事）。
 */
export function fallbackIconFor(src, pageUrl) {
  const s = String(src || '').trim()
  if (!s) return ''
  try {
    const guess = `${new URL(normalizeUrl(pageUrl)).origin}/favicon.ico`
    return s === guess ? '' : guess
  } catch {
    return ''
  }
}

/* =========================================================================
   图标来源（iconMode）
   ========================================================================= */

/**
 * 书签图标的三种来源 —— 用户在添加 / 编辑弹窗里自己选。
 *
 *   initial  只用「网站名称首字母 + 渐变底」
 *   favicon  自动抓站点自己的 `/favicon.ico`（抓不到回落首字母）
 *   custom   用 `icon` 字段里的地址（自己填的 URL / 上传后的地址）
 *
 * ⚠️ 2026-10-14 之前**没有这个字段**，那时「首字母」只是 favicon 的兜底，
 *    用户看不见也控制不了：站点有图标就一定有图标，想要字母块做不到。
 */
export const ICON_MODES = ['initial', 'favicon', 'custom']

/**
 * 这条书签的图标来源。
 *
 * 认不出来的值（老数据没有这个字段、或者数据被改坏了）按**当时的行为**推断，
 * 而不是抛错或返回空 —— 图标是装饰，不该因为它让整张卡片渲染不出来。
 */
export function resolveIconMode(item) {
  const m = item?.iconMode
  if (ICON_MODES.includes(m)) return m
  return String(item?.icon || '').trim() ? 'custom' : 'favicon'
}

/**
 * 卡片上真正要渲染的图标地址。返回 `''` 表示「只显示首字母」。
 *
 * ⚠️ 对**存量数据**，本函数与老的 `faviconOf(item.url, item.icon)` **逐分支等价**
 *    （这正是能安全替换掉全部渲染调用点的前提）：
 *
 *      iconMode 缺省 + icon 非空 → custom  → faviconOf(url, icon)  ← 同老行为
 *      iconMode 缺省 + icon 为空 → favicon → faviconOf(url, '')    ← 同老行为
 *      icon 非空但地址不合格     → custom  → faviconOf 内部回落到站点图标 ← 同老行为
 *
 *    唯一的新行为是 `initial`：直接返回 `''`，`<img>` 压根不渲染，只剩字母块。
 *
 * ⚠️⚠️ 2026-10-14（第二轮）起，**favicon 模式下 `item.icon` 的语义变了**：
 *    它不再是「用户填的自定义地址」，而是「**页面 HTML 里解析到的真图标地址**」的缓存
 *    （由 `siteIcon.js` 的 `resolveSiteIcon()` 解析、弹窗保存时写进去）。
 *    所以 favicon 与 custom 两条分支现在**走同一条路**：
 *
 *      favicon → item.icon 有值（解析成功）→ 用它          ← 这是「抓真图标」的修复
 *      favicon → item.icon 为空（没解析到）→ origin/favicon.ico  ← 老行为，仍在
 *
 *    对存量数据**仍然逐条等价** —— 老数据里 favicon 模式的 `icon` 本来就是空的。
 */
export function iconSrcFor(item) {
  if (!item) return ''
  const mode = resolveIconMode(item)
  if (mode === 'initial') return ''
  return faviconOf(item.url, item.icon)
}

/* =========================================================================
   从页面 HTML 里挑出「站点自己声明的图标」
   ========================================================================= */

/**
 * `rel` 里出现这些词才算图标，值 = 优先顺序（小的优先）。
 *
 *   icon                          浏览器地址栏/标签页用的那个，首选
 *   apple-touch-icon(-precomposed) 通常是 180×180 的 PNG，质量更好
 *   fluid-icon                    GitHub 在用的高分辨率图标
 *
 * ⚠️ 特意**不收** `mask-icon` —— 那是 Safari 固定标签页用的**单色**图形，
 *    拿来当普通图标会得到一个纯黑/纯白的色块。
 *
 * ⚠️ `rel="shortcut icon"` 与 `rel="alternate icon"` 都落在 `icon` 这一档：
 *    前者是老写法（`shortcut` 只是个历史包袱），后者是 GitHub 给 .ico 兜底用的，
 *    两者浏览器都认。
 */
const ICON_REL_PRIORITY = {
  icon: 0,
  'apple-touch-icon': 1,
  'apple-touch-icon-precomposed': 1,
  'fluid-icon': 2,
}

/**
 * 注释、`<script>`、`<style>` 里的内容一律先删掉。
 *
 * ⚠️ 不删的话会踩两类假阳性：被注释掉的旧 `<link rel="icon">`
 *    （站点改版后经常留着），以及 JS 字符串里写着的 HTML 片段。
 *    两者都会让我们拿到一个**站点其实已经不用了**的地址。
 */
const HTML_NOISE_RE = /<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>/gi

/** 逐个 `<link …>` 标签。属性值里带 `>` 的（实际不存在）会截断，不影响结果。 */
const LINK_TAG_RE = /<link\b[^>]*>/gi

/** HTML 属性：双引号 / 单引号 / 无引号三种写法都认。 */
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g

/** 把一个 `<link …>` 标签的属性读成小写键的 map（同名取第一个，同 HTML 规则）。 */
function parseLinkAttrs(tag) {
  const out = {}
  ATTR_RE.lastIndex = 0
  let m
  while ((m = ATTR_RE.exec(tag))) {
    const name = m[1].toLowerCase()
    if (name in out) continue
    out[name] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return out
}

/** `sizes="180x180"` → 180。`sizes="any"`（矢量）当无穷大。取不到返回 0。 */
function sizeOf(attrs) {
  const s = String(attrs.sizes || '')
  if (!s) return 0
  if (/any/i.test(s)) return 1024
  let best = 0
  for (const m of s.matchAll(/(\d+)\s*[xX]\s*(\d+)/g)) {
    // 非正方形的取短边 —— 短边才是「放得下」的那个尺寸
    best = Math.max(best, Math.min(Number(m[1]), Number(m[2])))
  }
  return best
}

/**
 * 从一段 HTML 里挑出**站点自己声明的图标地址**（绝对地址）。
 * 挑不出来返回 `''` —— 由调用方决定怎么兜底（本项目是回落到 `/favicon.ico`）。
 *
 * 为什么需要它：`faviconOf()` 猜的是 `<origin>/favicon.ico`，而
 *
 *   · **GitHub Pages 项目站**（`user.github.io/repo/`）的真图标写在
 *     `<link rel="icon" href="/repo/static/img/favicon.jpg">` 里，
 *     它的 `/favicon.ico` 一律 404 —— 于是猜出来的地址会落到**域名根站点**，
 *     拿回一张**别人家的图**（实测：四站书签全都显示成了用户主页仓库的 Vue logo）。
 *   · 现在的站点大多也把图标放在带哈希的路径下（`/assets/icon-a1b2c3.svg`），
 *     根本没有 `/favicon.ico` 这个约定。
 *
 * 排序规则（和浏览器一致）：先按 `rel` 档位，再按 `sizes` 从大到小，最后按文档顺序。
 *
 * ⚠️ 纯函数、零依赖 —— 它必须能直接被 `scripts/probe-icon-mode.mjs` import，
 *    而那个脚本**要进 CI**（`npm ci` 之前就跑），不能碰浏览器 API 或 `@/` 别名。
 *
 * @param {string} html    页面 HTML（不需要完整，含 `<head>` 即可）
 * @param {string} baseUrl 解析相对地址用的基准，**应该是最终地址**（跟完重定向后的）
 */
export function extractIconHref(html, baseUrl) {
  let base = ''
  try {
    base = new URL(String(baseUrl || '')).href
  } catch {
    return ''
  }
  const src = String(html || '').replace(HTML_NOISE_RE, '')
  if (!src) return ''

  const found = []
  LINK_TAG_RE.lastIndex = 0
  let tag
  let order = 0
  while ((tag = LINK_TAG_RE.exec(src))) {
    const attrs = parseLinkAttrs(tag[0])
    const rel = String(attrs.rel || '').toLowerCase()
    if (!rel) continue

    let prio = -1
    for (const token of rel.split(/\s+/)) {
      const p = ICON_REL_PRIORITY[token]
      if (p != null && (prio < 0 || p < prio)) prio = p
    }
    if (prio < 0) continue

    const href = String(attrs.href || '').trim()
    if (!href) continue
    // 内联图片：地址本身可能是几十 KB 的 base64，写进 `icon` 字段纯属自残
    if (/^data:/i.test(href)) continue

    let abs
    try {
      abs = new URL(href, base).href
    } catch {
      continue
    }
    if (!/^https?:/i.test(abs)) continue
    found.push({ abs, prio, size: sizeOf(attrs), order: order++ })
  }
  if (!found.length) return ''

  const better = (a, b) =>
    a.prio !== b.prio ? a.prio - b.prio : a.size !== b.size ? b.size - a.size : a.order - b.order

  // 同一个地址可能被声明多次（比如同时写了 shortcut icon 和 icon），按最优的那条算
  const best = new Map()
  for (const f of found) {
    const cur = best.get(f.abs)
    if (!cur || better(f, cur) < 0) best.set(f.abs, f)
  }
  return [...best.values()].sort(better)[0].abs
}

/**
 * URL 的归一化比较键 —— 补协议 + 去尾斜杠 + 小写。
 *
 * 用来判断「两条书签是不是同一个站点」。**全项目只此一处**：
 * 导入去重（useStore.upsertBookmarks）、编辑校验（isDuplicateUrl）、
 * 本机→云端合并（data/transfer.js）都走它。
 * 分开写的话，某一边松一点就会出现「导入时说重复、合并时说不重复」这种鬼故事。
 */
export function bookmarkKey(url) {
  return normalizeUrl(url).replace(/\/$/, '').toLowerCase()
}

/** 数组按 key 分组。 */
export function groupBy(list, key) {
  return list.reduce((acc, item) => {
    const k = typeof key === 'function' ? key(item) : item[key]
    ;(acc[k] ||= []).push(item)
    return acc
  }, {})
}

/** 简易防抖，每个调用点独立持有定时器。 */
export function debounce(fn, wait = 200) {
  let timer = null
  return (...args) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, wait)
  }
}

/** 把树拍平。 */
export function flattenTree(nodes, depth = 0, out = []) {
  for (const n of nodes) {
    out.push({ ...n, depth })
    if (n.children?.length) flattenTree(n.children, depth + 1, out)
  }
  return out
}

/** 把扁平列表拼成树（parentId 为 null / '' 视为根）。 */
export function buildTree(list, parentId = null) {
  return list
    .filter((n) => (n.parentId ?? null) === parentId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((n) => {
      const children = buildTree(list, n.id)
      return children.length ? { ...n, children } : { ...n }
    })
}

/** 下载一个文本文件。 */
export function download(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 复制文本到剪贴板（带降级）。 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

/** 读取文件为文本。 */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result || ''))
    fr.onerror = () => reject(fr.error)
    fr.readAsText(file)
  })
}

/** 读取文件为 dataURL。 */
export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result || ''))
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(file)
  })
}

/** 格式化日期为 YYYY-MM-DD。 */
export function formatDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 把 `?redirect=` 洗成「站内路径」，洗不出来就返回空串。
 *
 * 只收以**单个** `/` 开头的路径：
 *   · `//evil.com` —— 浏览器会当成**协议相对 URL**，跳过去就是开放重定向；
 *   · `/\evil.com` —— 有些浏览器把它同样当协议相对（`\` 会被归一成 `/`）。
 * 这两个必须挡掉，其余（`/admin`、`/discover?x=1`）放行。
 *
 * 放在 helpers 而不是 router 里：`LoginView` 也要用，
 * 从 `@/router` 反向 import 会绕成一个环。
 */
export function safeRedirect(v) {
  const s = typeof v === 'string' ? v : ''
  if (!s.startsWith('/')) return ''
  if (s.startsWith('//') || s.startsWith('/\\')) return ''
  return s
}
