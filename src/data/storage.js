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
     writeAll(snapshot) -> boolean        全量恢复
     clearBusiness()    -> void           只清业务数据，保留设置

   ⚠️ 切换适配器后必须**重新 initStore**（见 useStore 的 reloadStore），
      否则内存里还是上一个模式的数据。
   ========================================================================= */

import { storageKeys } from '@/data/options'
import { clone } from '@/utils/helpers'
import { supabaseAdapter, setLocalFallback, clearCloudCache } from '@/data/adapters/cloud'
import { supabaseConfigured } from '@/data/supabase'

const PREFIX = 'jt:'

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

  /** 恢复：先清掉已有的，再写入快照。 */
  async writeAll(snapshot) {
    for (const key of Object.values(storageKeys)) safeRemove(key)
    for (const [key, value] of Object.entries(snapshot || {})) {
      if (key.startsWith(PREFIX)) safeSet(key, value)
    }
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
