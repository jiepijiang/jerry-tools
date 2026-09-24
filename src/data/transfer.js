/* =========================================================================
   本机 ↔ 云端的数据搬运
   -------------------------------------------------------------------------
   两个使用场景：

     1. 首次登录（云端还是空的）→ 自动把本机那份搬上去
        （useAuth 的 transferLocalToCloud('fill')）
     2. 用户手动点「上传本机数据到云端」→ 与云端**并集**，只补不删
        （useAuth 的 pushLocalToCloud）

   这个文件只放**纯逻辑** —— 键名归一化、并集合并、统计。
   真正的读写交给 storage，这样它可以脱离浏览器单测。

   ⚠️ 为什么需要键名归一化
      设置面板的「导出」按钮产出的 JSON 是 `{ categories: [...], bookmarks: [...] }`，
      而 `storageKeys.categories` 是 `'jt:categories'`。
      两个适配器的 writeAll 都按 storageKeys 匹配 —— 不做归一化的话
      「导出 → 恢复」这条链会**静默失效**（本地模式下还会先清空再什么都不写，
      等于恢复一次清一次库）。见 /tmp/jerry-sb/transfer-verify.mjs。
   ========================================================================= */

import { storageKeys } from '@/data/options'
import { bookmarkKey } from '@/utils/helpers'

const PREFIX = 'jt:'

/**
 * 参与「本机 → 云端」搬运的业务数据。
 *
 * 刻意**不含** sites / favorites / visits / users / share / settings：
 *   - sites 是全局表，只有 admin 能写，且已由 seed-discover.mjs 用 service_role 灌过；
 *   - favorites / visits 是「跟着账号走的行为记录」，本机那份属于**未登录时**的
 *     匿名浏览，搬到云端等于把匿名的记录算到账号头上；
 *   - users 在云端是 profiles（uuid 主键），本机那份是 `u_admin` 这种假 id，写不进去；
 *   - share / settings 各有自己的同步路径（useSettings）。
 */
export const TRANSFER_KEYS = [storageKeys.categories, storageKeys.bookmarks, storageKeys.notes]

/** `categories` → `jt:categories`；已经带前缀的原样返回。 */
export function normalizeStorageKey(key) {
  const k = String(key || '')
  if (!k) return ''
  return k.startsWith(PREFIX) ? k : `${PREFIX}${k}`
}

/** 是不是本项目认识的存储键。 */
export function isKnownStorageKey(key) {
  return Object.values(storageKeys).includes(normalizeStorageKey(key))
}

/**
 * 把外部文件里的快照整理成「只含认识的键」的对象。
 *
 * ⚠️ 返回 `null` 表示**一个键都认不出**。调用方必须据此**拒绝写入**，
 *    绝不能「先清空再写」—— 那样一个格式不对的文件就能把用户的数据全抹掉。
 */
export function normalizeSnapshot(snapshot) {
  const out = {}
  for (const [k, v] of Object.entries(snapshot || {})) {
    const key = normalizeStorageKey(k)
    if (!isKnownStorageKey(key)) continue
    out[key] = v
  }
  return Object.keys(out).length ? out : null
}

/* ------------------------------------------------------------ 合并 */

/**
 * 分类按 `id` 取并集。云端已有的是权威，本机只补云端没有的。
 *
 * 为什么不让本机覆盖：云端那份可能刚在另一台设备上改过名 / 挪过位置，
 * 用本机的旧值盖回去等于把那次编辑吞掉。而「本机有、云端没有」的
 * （用户导入时新建的分类）正是我们要补的。
 */
export function mergeCategories(cloudRows, localRows) {
  const rows = [...(cloudRows || [])]
  const seen = new Set(rows.map((c) => c.id))
  let added = 0
  let skipped = 0
  for (const c of localRows || []) {
    if (!c?.id || seen.has(c.id)) {
      skipped++
      continue
    }
    seen.add(c.id)
    rows.push(c)
    added++
  }
  return { rows, added, skipped }
}

/**
 * 书签按 **URL** 取并集（口径见 helpers.bookmarkKey，与导入去重同一个）。
 *
 * 为什么是 URL 不是 id：同一个站点在本机和在云端很可能是两条不同的记录 ——
 * 种子那 22 条 id 一样（`b1`…`b22`）能对上，但用户后来导入的条目
 * id 是各自 `uid()` 生成的，同一个网址在两边会拿到两个不同的 id。
 * 按 id 去重会让云端凭空多出一份重复书签。
 *
 * 另外还挡一手 **id 撞车**：id 相同但 URL 不同的两条，upsert 会按
 * `(user_id, id)` 覆盖云端那行 —— 那是静默改数据。宁可丢掉本机这条。
 */
export function mergeBookmarks(cloudRows, localRows) {
  const rows = [...(cloudRows || [])]
  const byId = new Set(rows.map((b) => b.id))
  const byUrl = new Set(rows.map((b) => bookmarkKey(b.url)).filter(Boolean))
  let added = 0
  let skipped = 0
  for (const b of localRows || []) {
    if (!b?.url) {
      skipped++
      continue
    }
    const u = bookmarkKey(b.url)
    if (byId.has(b.id) || byUrl.has(u)) {
      skipped++
      continue
    }
    byId.add(b.id)
    byUrl.add(u)
    rows.push(b)
    added++
  }
  return { rows, added, skipped }
}

/** 便签按 id 取并集（同分类的逻辑）。 */
export function mergeNotes(cloudRows, localRows) {
  return mergeCategories(cloudRows, localRows)
}

/**
 * 算出「本机 → 云端」要写什么。**纯函数**，不碰存储，便于单测。
 *
 * 返回每一类的 `{ rows, added, skipped, changed }` 加一个总计数。
 */
export function planTransfer(cloud, local) {
  const categories = mergeCategories(cloud?.categories, local?.categories)
  const bookmarks = mergeBookmarks(cloud?.bookmarks, local?.bookmarks)
  const notes = mergeNotes(cloud?.notes, local?.notes)

  const withFlag = (r) => ({ ...r, changed: r.added > 0 })
  const out = {
    categories: withFlag(categories),
    bookmarks: withFlag(bookmarks),
    notes: withFlag(notes),
  }
  out.added = categories.added + bookmarks.added + notes.added
  out.skipped = categories.skipped + bookmarks.skipped + notes.skipped
  out.changed = out.added > 0
  return out
}
