/* =========================================================================
   数据适配层
   -------------------------------------------------------------------------
   当前实现是 localStorage（纯前端，零后端）。

   之所以单独抽一层：之后若要接 Supabase，只要再写一个实现同样方法的
   对象替换掉 `storage` 即可，上层 useStore 完全不用改。
   方法都返回 Promise，方便以后换成真正的网络请求。

   接口约定（每个实体都是 list + 覆盖写）：
     read(key)          -> any | null
     write(key, value)  -> void
     remove(key)        -> void
     readAll()          -> 全量快照（用于备份）
     writeAll(snapshot) -> 全量恢复
   ========================================================================= */

import { storageKeys } from '@/data/options'
import { clone } from '@/utils/helpers'

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

/**
 * 当前生效的适配器。
 * 换成 Supabase 时：`export const storage = supabaseAdapter` 即可。
 */
export const storage = localStorageAdapter

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
