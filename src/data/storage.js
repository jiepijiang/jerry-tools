/* =========================================================================
   数据适配层（路由）
   -------------------------------------------------------------------------
   两个实现，按登录态切换：

     未登录 / 没配 Supabase  → localStorage（即接入前的行为，完全离线可用）
     已登录                  → Supabase（跨设备同步）

   上层（useStore / useSettings / SettingsPanel）只认这组方法，不知道底下是谁：

     read(key)          -> any | null
     readState(key)     -> { state: 'ok' | 'absent' | 'unreadable', value, reason? }
                           ⚠️ `read` 分不清「键不存在」和「读不出来」，两者都是 null。
                              需要区分时用 `readState`（`seedIfEmpty` 就是靠它
                              才不会把坏值当成空、进而用种子覆盖掉用户数据）。
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

  /**
   * 读一个键，**并且说清楚为什么读不出来**。
   *
   * ⚠️⚠️ `read()` 的返回类型是 `any | null` —— 「键**不存在**」和
   *    「键存在但**解析不了**」都变成 `null`，调用方**没法区分**。
   *    而 `seedIfEmpty()` 原来的判据是 `!v || !v.length`，于是
   *    「读失败」被当成「没有数据」，紧接着 `persist()` 把种子写进去 ——
   *    **用户的原始字节被覆盖，且不可恢复**。
   *    实测（`/tmp/jerry-sb/read-fail-audit.mjs`）：`jt:bookmarks` 存成 `'{'`
   *    之后打开页面，它会被 22 条种子顶掉，界面上显示的正是那些种子。
   *
   * 这个方法把三态显式化：
   *
   *   'ok'          读到了，`value` 是解析后的值
   *   'absent'      键**不存在**（只有首次启动才会这样）
   *   'unreadable'  键存在，但读不出来（坏 JSON / 隐私模式）
   *
   * ⚠️ 判据是「`getItem` 返回什么」而不是「`JSON.parse` 成不成功」：
   *    只有 `getItem` 返回 `null` 才代表键不存在。
   *
   * ⚠️ 隐私模式（连 `getItem` 都抛）**也算 unreadable，不能算 absent** ——
   *    算成 absent 会在「读不了」的时候往存储里灌种子，方向正好反了。
   */
  async readState(key) {
    let raw
    try {
      raw = localStorage.getItem(key)
    } catch {
      return { state: 'unreadable', value: null, reason: 'storage_denied' }
    }
    if (raw == null) return { state: 'absent', value: null }
    try {
      return { state: 'ok', value: JSON.parse(raw) }
    } catch {
      return { state: 'unreadable', value: null, reason: 'bad_json' }
    }
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
   * 返回值：false 表示「这份快照没写成功」，调用方应当据此提示失败。
   *
   * ⚠️⚠️ **不能「先 remove 再 set」，也不能吞掉 `safeSet` 的返回值。**
   *    原来的写法是 `for (key) safeRemove(key)` 再 `for (key) safeSet(key)`，
   *    两个问题叠在一起，后果比「恢复失败」严重得多：
   *      1. `safeSet` 的返回值被丢掉 → 写失败也返回 `true` →
   *         上层（SettingsPanel 明明检查了返回值）报「恢复完成」；
   *      2. **`set` 失败时原值已经被 `remove` 掉了** → 用户的分类 / 书签 /
   *         设置直接没了，界面上却写着「恢复完成」。刷新后 `seedIfEmpty()`
   *         看到空存储，还会把种子灌回来 —— 用户看到的是
   *         「我恢复了个备份，结果回到默认数据了」。
   *    实测（注入 `QuotaExceededError`，`/tmp/jerry-sb/write-fail-audit.mjs` 场景 8）：
   *    3 条书签 → 变成 **22 条种子**，且 toast 是「恢复完成」。
   *
   *    `setItem` 对已存在的键本来就是**原子覆盖**，不需要先删。
   *    去掉 remove 之后，「写失败」最多是「恢复了一半」，
   *    **绝不会把没写进去的键抹掉**。云端那份 `writeAll` 一直是这么写的
   *    （先写、逐个检查返回值、不删），这里跟它对齐。
   *
   *    仍然做不到原子：配额满时前面的键可能已经写进去了。
   *    所以第一个失败就**中止**并返回 false，让调用方如实报失败。
   */
  async writeAll(snapshot) {
    const clean = normalizeSnapshot(snapshot)
    if (!clean) return false
    for (const [key, value] of Object.entries(clean)) {
      // `undefined` 在快照里表示「这个键置空」，交给 remove
      if (value === undefined) {
        safeRemove(key)
        continue
      }
      if (!safeSet(key, value)) return false
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
  readState: (key) => active.readState(key),
  write: (key, value) => active.write(key, value),
  remove: (key) => active.remove(key),
  readAll: () => active.readAll(),
  writeAll: (snapshot) => active.writeAll(snapshot),
  clearBusiness: () => active.clearBusiness(),
}

/** 备份快照的版本号，恢复时用来判断兼容性。 */
export const SNAPSHOT_VERSION = 1

/**
 * 导出为带元信息的备份对象。
 *
 * ⚠️ `readAll()` 会**静默跳过**读不出来的键（`safeGet` 把它们变成 null，
 *    然后被 `if (v != null)` 过滤掉）。于是「存储坏了一张表」时，
 *    导出的备份里少一张表，而调用方 toast 说的是「备份已下载」——
 *    用户以为手里有一份完整备份，真出事时才发现缺的就是最重要的那张。
 *    实测（`/tmp/jerry-sb/read-fail-audit.mjs` 场景 6）：`jt:notes` 就是这么消失的。
 *
 * 所以这里额外算出 `missing`（**键存在但读不出来**的那些），
 * 让调用方有机会如实提示。`missing` 是附加字段，不影响恢复侧的解析。
 */
export async function exportSnapshot() {
  const data = await storage.readAll()
  const missing = []
  for (const key of Object.values(storageKeys)) {
    if (key in data) continue
    const st = await storage.readState(key)
    if (st.state === 'unreadable') missing.push(key)
  }
  return {
    version: SNAPSHOT_VERSION,
    app: 'jerry-tools',
    exportedAt: new Date().toISOString(),
    data: clone(data),
    missing,
  }
}
