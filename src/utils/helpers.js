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
 * 站点图标地址。
 * 优先级：数据里写死的自定义图标 → 站点自己的 /favicon.ico → 由调用方渲染首字母兜底。
 *
 * 特意**不用** Google 的 s2 favicon 服务：它在国内不可达，会让整页图标集体挂掉，
 * 而且批量请求还会被限流。让每个站点自己提供图标，既没有第三方依赖也不会被限。
 */
export function faviconOf(url, custom) {
  if (custom) return custom
  try {
    const host = new URL(normalizeUrl(url)).origin
    return `${host}/favicon.ico`
  } catch {
    return ''
  }
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
