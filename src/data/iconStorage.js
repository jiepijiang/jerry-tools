/* =========================================================================
   用户上传的图片 → 一个能直接塞进 <img src> 的地址
   -------------------------------------------------------------------------
   背景：头像 / 书签图标 / 站点图标三处上传，原先一律 `readFileAsDataURL()`
   把图片转成 base64 **写进业务表**。一张 2MB 的图 base64 之后是 ~2.7MB，
   直接塞进一行；本机模式还会撞 localStorage 配额。

   现在：图片一律**先缩到最长边 256px、转成 WebP**，然后

     · 已登录 + 配了后端  →  传到 Storage，返回**公开 URL**
     · 未登录 / 没配后端  →  返回 dataURL（**这是设计，不是失败**）

   ## 为什么未登录要用 dataURL 而不是报错

   本站有一条**刻意保留的降级路径**：没配 Supabase 时整个 app 退回纯
   localStorage 模式（见 `data/supabase.js` 顶部注释）。那条路径下没有
   Storage 可用，dataURL 是唯一能存的形态。所以「未登录 → dataURL」
   是正常分支，不打日志、不报错。

   ## 但「已登录却传不上去」必须抛错

   这两种情况**必须分开**，不能都悄悄回落成 base64：

     · 未登录 → 没有云端，dataURL 是**正确**的存储形态；
     · 已登录 → 有云端却传失败（网络 / 策略配错 / bucket 不存在），
       这时候回落到 base64 就是**把要修的问题又做了一遍** ——
       而且没人会发现（表现是「图标设上了」）。

   所以这里抛，由调用方 toast 报错。对齐 README 那条
   「写失败却报『成功』是违约，不是设计取舍」。

   ## 路径与去重

     user-assets/{auth.uid()}/{kind}-{sha256 前 16 位}.{ext}

   `kind` 只影响文件名，**不影响策略** —— 策略只看第一段目录是不是本人 uid
   （见 `supabase/migrations/005-user-assets-storage.sql`）。
   文件名带内容哈希：同一张图重复上传会落到同一个路径，天然去重。
   ⚠️ 代价是**换图之后旧文件不会被删**（存储只涨不跌）。
      现在不做回收，记在 README 的已知限制里。
   ========================================================================= */

import { supabase, supabaseConfigured, currentUserId } from '@/data/supabase'
import { readFileAsDataURL } from '@/utils/helpers'

/** bucket 名。改这里要同步改 `005-user-assets-storage.sql`。 */
export const BUCKET = 'user-assets'

/**
 * 缩放后的最长边（px）。
 * 图标最大渲染 52px、头像 96px，3× DPR 也就 288 —— 256 足够且留了余量。
 */
export const MAX_EDGE = 256

/** WebP 质量。0.9 在图标这种小图上肉眼看不出损失，体积通常是 PNG 的 1/3。 */
const WEBP_QUALITY = 0.9

/* ------------------------------------------------------------ 缩放 + 转码 */

/**
 * 把 File 缩到最长边 MAX_EDGE 并转成 WebP。
 *
 * 返回 `{ blob, ext, type }`；**任何一步失败都返回 null**，由调用方决定回落。
 * 故意不抛：调用方要区分「图本身有问题」和「网络传不上去」，
 * 这两种的提示文案不一样。
 *
 * ⚠️ 用 `createImageBitmap` 而不是 `<img>` + `URL.createObjectURL`：
 *    后者要等 load 事件、还要记得 revoke，而且拿不到「解码失败」这个信号。
 *    `createImageBitmap` 对坏图直接 reject，正好。
 */
async function toOptimizedBlob(file) {
  let bmp
  try {
    bmp = await createImageBitmap(file)
  } catch {
    return null // 解不开 —— 多半不是真的图片，或者格式浏览器不认
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bmp, 0, 0, w, h)

    // 先试 WebP。Safari 14 之前的 canvas 不支持编码 webp，
    // 此时 toBlob 会给 null（而不是抛），所以这里要判空再回落 PNG。
    const webp = await new Promise((r) => canvas.toBlob(r, 'image/webp', WEBP_QUALITY))
    if (webp) return { blob: webp, ext: 'webp', type: 'image/webp' }

    const png = await new Promise((r) => canvas.toBlob(r, 'image/png'))
    if (png) return { blob: png, ext: 'png', type: 'image/png' }

    return null
  } catch {
    return null
  } finally {
    // 不 close 的话，连续上传几张图会把解码后的位图全留在内存里
    if (typeof bmp.close === 'function') bmp.close()
  }
}

/* ------------------------------------------------------------ 文件名哈希 */

/**
 * 内容哈希的前 16 位十六进制。
 *
 * `crypto.subtle` 只在**安全上下文**（https / localhost）可用 ——
 * 正常部署和本地 dev 都满足，但为了不在奇怪环境里整条上传挂掉，
 * 拿不到时回落到一个「够用就好」的简单散列（只用于文件名去重，不是安全用途）。
 */
async function contentHash(blob) {
  const buf = await blob.arrayBuffer()
  try {
    const digest = await crypto.subtle.digest('SHA-256', buf)
    return [...new Uint8Array(digest)]
      .slice(0, 8)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    // FNV-1a 32 位，取两轮拼起来降低碰撞
    const bytes = new Uint8Array(buf)
    let a = 0x811c9dc5
    let b = 0x01000193
    for (let i = 0; i < bytes.length; i++) {
      a = ((a ^ bytes[i]) * 16777619) >>> 0
      b = ((b + bytes[i] * (i + 1)) * 16777619) >>> 0
    }
    return (a.toString(16) + b.toString(16)).padStart(16, '0').slice(0, 16)
  }
}

/* ------------------------------------------------------------ 对外入口 */

/**
 * 处理一次图片上传，返回可以直接存进业务表的地址。
 *
 * @param {File}   file  用户选的文件
 * @param {string} kind  用途，只进文件名：`'icon'` | `'avatar'`
 * @returns {Promise<{ url: string, mode: 'cloud' | 'local', bytes: number }>}
 * @throws {Error} 已登录但上传失败时抛；`error.code` 见下
 *   - `not-an-image` 图解不开（调用方应该提示「不是有效图片」）
 *   - `upload-failed` 传不上去（网络 / 策略 / bucket 没建）
 */
export async function uploadImage(file, kind = 'icon') {
  const optimized = await toOptimizedBlob(file)

  // 缩不了就退回原图。宁可存大一点，也不要因为「这张图 canvas 处理不了」
  // 就让用户设不上图标 —— 转码是优化，不是前提。
  const payload = optimized || {
    blob: file,
    ext: (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg'),
    type: file.type || 'image/png',
  }

  if (!optimized && !/^image\//.test(payload.type)) {
    const e = new Error('不是有效的图片')
    e.code = 'not-an-image'
    throw e
  }

  const uid = supabaseConfigured ? await currentUserId() : null

  /* ---- 降级路径：没有云端，就用 dataURL（设计如此，不是失败） ---- */
  if (!uid) {
    // FileReader 收 Blob 就行，不用为了它再包一层 File
    const url = await readFileAsDataURL(payload.blob)
    return { url, mode: 'local', bytes: payload.blob.size }
  }

  /* ---- 正常路径：传 Storage，存公开 URL ---- */
  const hash = await contentHash(payload.blob)
  const path = `${uid}/${kind}-${hash}.${payload.ext}`

  const { error } = await supabase.storage.from(BUCKET).upload(path, payload.blob, {
    contentType: payload.type,
    // 同名同内容重复上传不该报错；内容变了哈希也会变，是另一个文件
    upsert: true,
    cacheControl: '31536000',
  })

  if (error) {
    const e = new Error(`上传失败：${error.message}`)
    e.code = 'upload-failed'
    e.cause = error
    throw e
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return { url: data.publicUrl, mode: 'cloud', bytes: payload.blob.size }
}
