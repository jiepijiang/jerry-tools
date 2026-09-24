/* =========================================================================
   数据适配层（路由）
   -------------------------------------------------------------------------
   两个实现，按登录态切换：

     未登录 / 没配 Supabase  → localStorage（即接入前的行为，完全离线可用）
     已登录                  → Supabase（跨设备同步）

   上层（useStore / useSettings / SettingsPanel）只认这组方法，不知道底下是谁：

     read(key)          -> any | null
     write(key, value)  -> boolean        写失败返回 false，调用方据此回滚
     remove(key)        -> void
     readAll()          -> 全量快照（备份用）
     writeAll(snapshot) -> boolean        恢复。**只动快照里出现的键**，
                                          一个键都认不出时返回 false 且不动数据
     clearBusiness()    -> void           只清业务数据，保留设置

   ⚠️ 切换适配器后必须**重新 initStore**（见 useStore 的 reloadStore），
      否则内存里还是上一个模式的数据。
   ========================================================================= */

import { storageKeys } from '@/data/options'
import { clone } from '@/utils/helpers'
import { normalizeSnapshot } from '@/data/transfer'
import { supabaseAdapter, setLocalFallback, clearCloudCache } from '@/data/adapters/cloud'
import { supabaseConfigured } from '@/data/supabase'

function safeGet(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? null : JSON.parse(raw)
  } catch {
    /* 隐私模式 / 数据损坏，都当作没有 */
    return null
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (e) {
    console.warn('[storage] 写入失败：', key, e)
    return false
  }
}

function safeRemove(key) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

/** localStorage 实现。 */
export const localStorageAdapter = {
  name: 'localStorage',

  async read(key) {
    return safeGet(key)
  },

  async write(key, value) {
    return safeSet(key, value)
  },

  async remove(key) {
    safeRemove(key)
  },

  /** 备份：把所有 jt: 前缀的键导成一个对象。 */
  async readAll() {
    const out = {}
    for (const key of Object.values(storageKeys)) {
      const v = safeGet(key)
      if (v != null) out[key] = v
    }
    return out
  },

  /**
   * 恢复：**只动快照里出现的键**，没写的不碰。
   *
   * ⚠️ 以前是「先清掉所有 storageKeys 再写快照里的键」，有两个后果：
   *
   *   1. **一个键都认不出时会清空整个库** —— 设置面板的「导出」产出的是
   *      `{categories, bookmarks}`（没有 `jt:` 前缀），而这里按前缀过滤，
   *      于是「清空 → 什么都没写」。用户点一次「恢复」就丢光数据。
   *      现在认不出任何键就**直接返回 false，一个字节都不动**。
   *   2. 只含部分键的文件（比如「导出」只有分类和书签）会把便签、
   *      收藏、访问统计一起抹掉。现在它们不在快照里就不会被碰。
   *
   * 键名用 normalizeStorageKey 归一化，所以 `categories` 和 `jt:categories`
   * 两种写法都能恢复 —— 兼容用户手里已经导出的旧文件。
   *
   * 返回值：false 表示「这份快照用不了」，调用方应当据此提示失败。
   */
  async writeAll(snapshot) {
    const clean = normalizeSnapshot(snapshot)
    if (!clean) return false
    for (const key of Object.keys(clean)) safeRemove(key)
    for (const [key, value] of Object.entries(clean)) safeSet(key, value)
    return true
  },

  /** 只清业务数据，保留设置。 */
  async clearBusiness() {
    for (const key of [
      storageKeys.categories,
      storageKeys.bookmarks,
      storageKeys.sites,
      storageKeys.favorites,
      storageKeys.submissions,
      storageKeys.feedback,
      storageKeys.notes,
      storageKeys.visits,
    ]) {
      safeRemove(key)
    }
  },
}

/* --------------------------------------------------------------- 路由 */

// 云端适配器读不到本地键（session / seedVersion）时，回落到本地实现
setLocalFallback(localStorageAdapter)

let active = localStorageAdapter

/** 当前适配器名，便于诊断页 / 控制台确认「我现在到底在用哪个」。 */
export function activeAdapterName() {
  return active.name
}

/** 切到云端。没配 Supabase 时是空操作，返回 false。 */
export function useCloudStorage() {
  if (!supabaseConfigured) return false
  if (active === supabaseAdapter) return true
  clearCloudCache()
  active = supabaseAdapter
  return true
}

/** 切回本地。 */
export function useLocalStorage() {
  if (active === localStorageAdapter) return true
  clearCloudCache()
  active = localStorageAdapter
  return true
}

export function isCloudActive() {
  return active === supabaseAdapter
}

/**
 * 当前生效的适配器。
 *
 * 这里用**转发对象**而不是直接 `export let storage = active` ——
 * ES module 的具名导出是活的绑定，但 `export let` 被重新赋值时，
 * 已经 `import { storage }` 拿到的引用**不会**跟着变（Babel/Vite 的
 * 转译行为不一致，很容易踩）。转发一次就完全没这个问题。
 */
export const storage = {
  get name() {
    return active.name
  },
  read: (key) => active.read(key),
  write: (key, value) => active.write(key, value),
  remove: (key) => active.remove(key),
  readAll: () => active.readAll(),
  writeAll: (snapshot) => active.writeAll(snapshot),
  clearBusiness: () => active.clearBusiness(),
}

/** 备份快照的版本号，恢复时用来判断兼容性。 */
export const SNAPSHOT_VERSION = 1

/** 导出为带元信息的备份对象。 */
export async function exportSnapshot() {
  const data = await storage.readAll()
  return {
    version: SNAPSHOT_VERSION,
    app: 'jerry-tools',
    exportedAt: new Date().toISOString(),
    data: clone(data),
  }
}
