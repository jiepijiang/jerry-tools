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
 *   - `data:image/…` —— 用户自己上传的（`BookmarkDialog` / 图标管理走 `readFileAsDataURL`）
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
 * 优先级：数据里写死的自定义图标 → 站点自己的 `/favicon.ico` → 由调用方渲染首字母兜底。
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
