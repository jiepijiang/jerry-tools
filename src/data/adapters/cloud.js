/* =========================================================================
   Supabase 适配器
   -------------------------------------------------------------------------
   关键点：**上层 useStore 一行都不用改。**

   useStore 的写操作全是「改内存数组 → 整体落盘」，
   而这个适配器把「整表覆盖写」翻译成行级 diff：
     1. 拿本次要写的新值和「上次从云端读到的快照」比
     2. 只 upsert 变了的行
     3. 只 delete 消失了的行

   为什么不用「整表 delete + insert」：那样每次改一个书签都要重写几百行，
   还会把 created_at 冲掉、把 RLS 的审计信息抹平。

   ⚠️ diff 依赖**读过的快照**。如果 write 之前没 read 过，
      这里会先补一次 read（`ensureCache`）—— 否则会把「远端已有的行」
      误判成「新增」，也会漏掉该删的行。
   ========================================================================= */

import { supabase, currentUserId } from '@/data/supabase'
import { storageKeys } from '@/data/options'

/* ------------------------------------------------------------ 字段名转换 */

const toSnakeKey = (k) => k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)
const toCamelKey = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())

/**
 * 这些字段在库里是 timestamptz，但**前端存的是 `YYYY-MM-DD`**
 * （见 helpers.js 的 formatDate）。
 *
 * 读回来时必须截断成同样精度，否则 diff 会永远认为「变了」：
 *   本地 `2026-09-20`  vs  云端 `2026-09-20T00:00:00+00:00`
 * 结果是每次写都重新 upsert 一遍全部行 —— 又慢又吵。
 */
const DATE_FIELDS = new Set(['created_at', 'updated_at', 'reviewed_at', 'replied_at'])

function rowToLocal(row) {
  const out = {}
  for (const [k, v] of Object.entries(row)) {
    if (k === 'user_id') continue // 内部字段，前端模型里没有
    const camel = toCamelKey(k)
    out[camel] = DATE_FIELDS.has(k) && typeof v === 'string' ? v.slice(0, 10) : v
  }
  return out
}

/** 今天的 `YYYY-MM-DD`（与 helpers.js 的 formatDate 同格式）。 */
const today = () => new Date().toISOString().slice(0, 10)

/**
 * 本地对象 → DB 行（snake_case）。
 *
 * ⚠️ 值为 `undefined` 的键**直接跳过**，不要写成 null。
 *    库里那些列大多有 default（`icon ''`、`created_at now()`），
 *    显式送 null 会撞上 not-null 约束：
 *      null value in column "icon" ... violates not-null constraint
 *    省略才是「用默认值 / 保持原值」。
 */
function localToRow(obj, userId) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue
    out[toSnakeKey(k)] = v
  }
  if (userId) out.user_id = userId
  return out
}

/* ---------------------------------------------------------------- 表规格 */

/**
 * 表规格。
 *
 * kind:
 *   rows   本地是对象数组，按 id 认人
 *   ids    本地是字符串数组（如 favorites），每项一行
 *   map    本地是 {key: number}（如 visits）
 *   single 本地是单个对象，永远只有一行
 *   blob   本地是任意 JSON，塞进 data jsonb 列
 *
 * `columns` + `defaults` 是给 kind:'rows' 用的，**不能省**：
 * PostgREST 的批量写入要求**同一批对象的键完全一致**，
 * 缺的键它会给填成 NULL（老版本直接报 `PGRST102 All object keys must match`）。
 * 而前端的数据模型里字段是可选的 —— 种子书签里有 9 条没 `icon`、
 * 22 条全都没有 `createdAt`。不补齐的话：
 *   - 混着写 → 整批 400
 *   - 缺的字段 → `null value in column "icon" violates not-null constraint`
 * 所以这里按列清单把每行补齐到同一组键，缺的用列默认值。
 */
const SPECS = {
  [storageKeys.categories]: {
    table: 'categories',
    kind: 'rows',
    conflict: 'user_id,id',
    columns: ['id', 'name', 'icon', 'parent_id', 'sort_order'],
    defaults: { name: '', icon: 'Folder', parent_id: null, sort_order: 0 },
  },
  [storageKeys.bookmarks]: {
    table: 'bookmarks',
    kind: 'rows',
    conflict: 'user_id,id',
    columns: ['id', 'category_id', 'name', 'url', 'description', 'icon', 'sort_order', 'created_at'],
    defaults: { category_id: null, name: '', url: '', description: '', icon: '', sort_order: 0, created_at: today },
  },
  [storageKeys.notes]: {
    table: 'notes',
    kind: 'rows',
    conflict: 'user_id,id',
    columns: ['id', 'content', 'created_at', 'updated_at'],
    defaults: { content: '', created_at: today, updated_at: today },
  },
  [storageKeys.submissions]: {
    table: 'submissions',
    kind: 'rows',
    conflict: 'user_id,id',
    columns: ['id', 'title', 'url', 'description', 'category', 'subcategory', 'status', 'review_note', 'created_at'],
    defaults: { title: '', url: '', description: '', category: '其他', subcategory: '', status: 'pending', review_note: '', created_at: today },
  },
  [storageKeys.feedback]: {
    table: 'feedback',
    kind: 'rows',
    conflict: 'user_id,id',
    columns: ['id', 'content', 'contact', 'status', 'reply', 'created_at'],
    defaults: { content: '', contact: '', status: 'open', reply: '', created_at: today },
  },
  [storageKeys.favorites]: { table: 'favorites', kind: 'ids', idColumn: 'site_id', conflict: 'user_id,site_id' },
  [storageKeys.visits]: { table: 'visits', kind: 'map', idColumn: 'bookmark_id', valueColumn: 'count', conflict: 'user_id,bookmark_id' },
  [storageKeys.share]: { table: 'share_settings', kind: 'single' },
  [storageKeys.settings]: { table: 'user_settings', kind: 'blob' },

  // profiles 是 auth 触发器建的，前端只能改自己的那行。
  [storageKeys.users]: {
    table: 'profiles',
    kind: 'rows',
    conflict: 'id',
    // profiles 的主键就是 auth uid，**没有 user_id 这一列** ——
    // 不标这个的话补键逻辑会往里塞一个 user_id，直接 400。
    noUserCol: true,
    columns: ['id', 'email', 'nickname', 'avatar', 'role', 'disabled', 'note'],
    defaults: { email: '', nickname: '', avatar: '', role: 'user', disabled: false, note: '' },
    // 库里的 role / disabled 和前端模型的 isAdmin / disabled 不是一一对应
    fromDb: (row) => {
      const o = rowToLocal(row)
      o.isAdmin = row.role === 'admin'
      delete o.role
      return o
    },
    toDb: (obj, userId) => ({
      id: obj.id,
      email: obj.email ?? '',
      nickname: obj.nickname ?? '',
      avatar: obj.avatar ?? '',
      role: obj.isAdmin ? 'admin' : 'user',
      disabled: !!obj.disabled,
      note: obj.note ?? '',
    }),
  },

  // 发现页站点是**全局**数据，没有 user_id，主键就是 id。
  // 普通用户只能读，浏览量走 RPC 自增（见下面的 writeSites）。
  [storageKeys.sites]: {
    table: 'discover_sites',
    kind: 'rows',
    global: true,
    columns: ['id', 'title', 'url', 'description', 'icon', 'category', 'subcategory', 'views', 'collects', 'status', 'submitted_by', 'created_at'],
    defaults: { title: '', url: '', description: '', icon: '', category: '其他', subcategory: '', views: 0, collects: 0, status: 'pending', submitted_by: null, created_at: today },
  },
}

/** 这些键只存在本机，不进云端。 */
const LOCAL_ONLY = new Set([storageKeys.session, storageKeys.seedVersion])

/**
 * 要实时订阅的表。**与 SPECS 同源** —— 表名只在 SPECS 里写一次。
 *
 * 为什么没有 discover_sites：它是全局表，且 `views` 每次有人点开站点都会 +1。
 * 订阅它等于把**每一个用户的每一次点击**广播给所有在线设备。
 * 详见 supabase/migrations/003-realtime.sql。
 *
 * ⚠️ `filterColumn` 必须是**主键的一部分**。
 *    DELETE 事件的 `old_record` 默认只带主键列，过滤列不在主键里的话
 *    服务端匹配不上，DELETE 会被**静默丢掉** —— 表现是
 *    「改了能同步，删了不同步」，特别难往订阅配置上想。
 */
export const REALTIME_TABLES = Object.keys(SPECS)
  .filter((key) => key !== storageKeys.sites)
  .map((key) => ({
    key,
    table: SPECS[key].table,
    filterColumn: SPECS[key].noUserCol ? 'id' : 'user_id',
  }))

/* ------------------------------------------------------------------ 缓存 */

/** storageKey -> 上次从云端读到的原始行数组（snake_case）。 */
const snapshot = new Map()

export function clearCloudCache() {
  snapshot.clear()
}

/* ------------------------------------------------------------ 读 / 写实现 */

async function fetchRows(spec, key) {
  if (!supabase) throw new Error('Supabase 未配置')
  let q = supabase.from(spec.table).select('*')
  // profiles 不按 user_id 过滤也没关系（RLS 会挡），但显式过滤省一次全表扫
  const { data, error } = await q
  if (error) throw new Error(`读 ${spec.table} 失败：${error.message}`)
  const rows = data || []
  snapshot.set(key, rows)
  return rows
}

async function readCloud(key) {
  const spec = SPECS[key]
  if (!spec) return null

  const rows = await fetchRows(spec, key)

  switch (spec.kind) {
    case 'rows':
      return rows.map((r) => (spec.fromDb ? spec.fromDb(r) : rowToLocal(r)))
    case 'ids':
      return rows.map((r) => r[spec.idColumn])
    case 'map': {
      const out = {}
      for (const r of rows) out[r[spec.idColumn]] = r[spec.valueColumn]
      return out
    }
    case 'single': {
      const r = rows[0]
      return r ? rowToLocal(r) : null
    }
    case 'blob': {
      const r = rows[0]
      return r ? r.data : null
    }
    default:
      return null
  }
}

/** 把本地值转成 DB 行。rows 类型会按 `columns` 补齐键，见 SPECS 的注释。 */
function localToRows(spec, value, userId) {
  switch (spec.kind) {
    case 'rows':
      return (value || []).map((o) => {
        const src = spec.toDb ? spec.toDb(o, userId) : localToRow(o, spec.global ? null : userId)
        if (!spec.columns) return src

        // 补齐到同一组键 —— PostgREST 的批量写入对键一致性是硬要求
        const row = {}
        for (const c of spec.columns) {
          if (src[c] !== undefined) {
            row[c] = src[c]
            continue
          }
          const d = spec.defaults?.[c]
          row[c] = typeof d === 'function' ? d() : d === undefined ? null : d
        }
        if (!spec.global && !spec.noUserCol && userId) row.user_id = userId
        return row
      })
    case 'ids':
      return (value || []).map((id) => ({ [spec.idColumn]: id, user_id: userId }))
    case 'map':
      return Object.entries(value || {}).map(([id, n]) => ({
        [spec.idColumn]: id,
        [spec.valueColumn]: n,
        user_id: userId,
      }))
    case 'single':
      return value ? [{ ...localToRow(value, userId) }] : []
    case 'blob':
      return [{ user_id: userId, data: value ?? {} }]
    default:
      return []
  }
}

/**
 * 哪些列真的变了 —— 返回**库里那侧的列名**（snake_case）。
 *
 * ⚠️ 必须在**本地模型域**比较，不能在 DB 行域比。两边有三处天然不一致：
 *
 *   1. 我们只写 `spec.columns`，DB 行还多出 `created_at` / `updated_at` /
 *      `reviewed_at` / `replied_at` 这类由 default 或触发器补的列；
 *   2. 日期列在库里是 timestamptz 全精度，本地是 `YYYY-MM-DD`；
 *   3. profiles 的 `role` / `disabled` 与本地 `isAdmin` 既不同名也不同形。
 *
 * 在 DB 行域按「键的并集」比 → **每一行永远判定为「变了」**。
 * 后果不是慢一点，而是：
 *   - 每次写都整表重 upsert（975 条书签时，改一个收藏也要重写 975 行）；
 *   - `writeSites` 更狠，377 个站点逐个发 UPDATE（每个都被 RLS 挡下、刷一屏警告）；
 *   - 实时同步会把它放大成事件风暴（N 行变更 → 给每台设备推 N 条）。
 *
 * 走 `rowToLocal()` 之后日期被截断成同一精度，多出来的列也不会被比较
 * （我们只遍历**要写的那行**的列），三个问题一起消失。
 */
function changedColumns(prevRow, nextRow) {
  const a = rowToLocal(nextRow)
  const b = rowToLocal(prevRow)
  const out = []
  for (const col of Object.keys(nextRow)) {
    if (col === 'user_id') continue
    const camel = toCamelKey(col)
    const va = a[camel] === undefined ? null : a[camel]
    const vb = b[camel] === undefined ? null : b[camel]
    if (JSON.stringify(va) !== JSON.stringify(vb)) out.push(col)
  }
  return out
}

/** 这一行相比云端现有那行，需不需要写。 */
function rowChanged(prevRow, nextRow) {
  if (!prevRow) return true
  return changedColumns(prevRow, nextRow).length > 0
}

/**
 * 发现页站点的特殊写入。
 *
 * 站点是全局数据，普通用户没有 update 权限（RLS 会挡）。
 * 但「浏览量 +1」人人可做 —— 走 `increment_discover_site_views` 这个
 * SECURITY DEFINER 函数。所以这里把「只有 views 变了」的行挑出来走 RPC，
 * 其余（改标题、改分类）留给 admin，非 admin 会被 RLS 静默挡掉。
 */
async function writeSites(prevRows, nextRows) {
  const prevById = new Map(prevRows.map((r) => [r.id, r]))
  const nextIds = new Set(nextRows.map((r) => r.id))
  let ok = true

  for (const row of nextRows) {
    const prev = prevById.get(row.id)

    if (!prev) {
      // 新提交的站点 —— 只有 admin 能直接插 approved，
      // 普通用户插 pending 由 RLS 放行
      const { error } = await supabase.from('discover_sites').insert(row)
      if (error) {
        console.warn('[cloud] 插入站点失败（多半是权限）：', row.id, error.message)
        ok = false
      }
      continue
    }

    const changed = changedColumns(prev, row)
    if (!changed.length) continue

    if (changed.length === 1 && changed[0] === 'views') {
      const { error } = await supabase.rpc('increment_discover_site_views', { p_site_id: row.id })
      if (error) {
        console.warn('[cloud] 浏览量自增失败：', row.id, error.message)
        ok = false
      }
      continue
    }

    // 其余字段的改动只有 admin 能落库
    const patch = {}
    for (const k of changed) patch[k] = row[k]
    const { error } = await supabase.from('discover_sites').update(patch).eq('id', row.id)
    if (error) {
      console.warn('[cloud] 更新站点失败（多半是权限）：', row.id, error.message)
      ok = false
    }
  }

  // 删除同样只有 admin 能做
  for (const prev of prevRows) {
    if (nextIds.has(prev.id)) continue
    const { error } = await supabase.from('discover_sites').delete().eq('id', prev.id)
    if (error) {
      console.warn('[cloud] 删除站点失败（多半是权限）：', prev.id, error.message)
      ok = false
    }
  }

  return ok
}

async function writeCloud(key, value) {
  const spec = SPECS[key]
  if (!spec) return true

  const userId = await currentUserId()
  if (!userId) throw new Error('未登录，不能写云端')

  if (!snapshot.has(key)) await fetchRows(spec, key)
  const prevRows = snapshot.get(key) || []
  const nextRows = localToRows(spec, value, userId)

  if (spec.table === 'discover_sites') {
    const ok = await writeSites(prevRows, nextRows)
    if (ok) snapshot.set(key, nextRows)
    return ok
  }

  const idCol = spec.kind === 'ids' || spec.kind === 'map' ? spec.idColumn : 'id'
  const prevById = new Map(prevRows.map((r) => [r[idCol], r]))
  const nextIds = new Set(nextRows.map((r) => r[idCol]))

  // 1) 新增 + 改动
  const toUpsert = nextRows.filter((row) => rowChanged(prevById.get(row[idCol]), row))

  if (toUpsert.length) {
    const opts = spec.conflict ? { onConflict: spec.conflict } : undefined
    const { error } = await supabase.from(spec.table).upsert(toUpsert, opts)
    if (error) {
      console.error(`[cloud] 写 ${spec.table} 失败：`, error.message, error.details || '')
      return false
    }
  }

  // 2) 删掉本次没出现的行
  const toDelete = prevRows.filter((r) => !nextIds.has(r[idCol])).map((r) => r[idCol])
  if (toDelete.length) {
    const { error } = await supabase.from(spec.table).delete().in(idCol, toDelete)
    if (error) {
      console.error(`[cloud] 删 ${spec.table} 失败：`, error.message)
      return false
    }
  }

  snapshot.set(key, nextRows)
  return true
}

/* ------------------------------------------------------------ 实时变更 */

/**
 * 一条 DB 行 → 本地模型里「那一行」的形态。
 * 与 readCloud 的各 kind 分支一一对应，只是这里只处理单行。
 */
function rowToLocalValue(spec, row) {
  switch (spec.kind) {
    case 'rows':
      return spec.fromDb ? spec.fromDb(row) : rowToLocal(row)
    case 'ids':
      return row[spec.idColumn]
    case 'map':
      return row[spec.valueColumn]
    case 'single':
      return rowToLocal(row)
    case 'blob':
      return row.data
    default:
      return null
  }
}

/**
 * 处理一条 realtime 变更，返回「该往 state 上打什么补丁」：
 *
 *   { op: 'upsert', id, value }   新增或更新一行
 *   { op: 'remove', id }          删掉一行
 *   { op: 'reload' }              快照缺失，调用方应做一次全量重读
 *   null                          不用管
 *
 * ⚠️ 这里**只维护快照，不碰 state**。state 归 useStore 管。
 *    分开的用意是让「回声抑制」有个明确判据：调用方拿到 value 后
 *    和 state 里的现值比一下，一样就什么都不做。
 *    自己写下去的改动会被服务端**原样回推**一份，没有这一步的话，
 *    每次写都会白刷一遍 UI（列表重排、输入框失焦、动画重放）。
 */
export function applyRemoteChange(key, eventType, newRow, oldRow) {
  const spec = SPECS[key]
  if (!spec) return null

  const rows = snapshot.get(key)
  /**
   * ⚠️ 快照缺失时**不能**就地建一个。
   *    只含这一行的快照会让下一次写把云端其余行全判成「已删除」——
   *    那是真的删数据。宁可让调用方多做一次全量读。
   */
  if (rows == null) return { op: 'reload' }

  const idCol = spec.kind === 'rows' ? 'id' : spec.idColumn || 'user_id'

  if (eventType === 'DELETE') {
    const id = (oldRow || {})[idCol]
    // DELETE 的 old_record 默认只带主键列；连身份都拿不到就退回全量读
    if (id === undefined) return { op: 'reload' }
    const i = rows.findIndex((r) => r[idCol] === id)
    if (i >= 0) rows.splice(i, 1)
    return { op: 'remove', id }
  }

  const row = newRow || {}
  const id = row[idCol]
  if (id === undefined) return { op: 'reload' }

  const i = rows.findIndex((r) => r[idCol] === id)
  if (i >= 0) rows[i] = row
  else rows.push(row)

  return { op: 'upsert', id, value: rowToLocalValue(spec, row) }
}

/* ---------------------------------------------------------------- 适配器 */

/** 本地兜底：云端读失败 / 未配置时的降级，直接复用 localStorage 实现。 */
let localFallback = null
export function setLocalFallback(adapter) {
  localFallback = adapter
}

export const supabaseAdapter = {
  name: 'supabase',

  async read(key) {
    if (LOCAL_ONLY.has(key) || !SPECS[key]) {
      return localFallback ? localFallback.read(key) : null
    }
    return readCloud(key)
  },

  async write(key, value) {
    if (LOCAL_ONLY.has(key) || !SPECS[key]) {
      return localFallback ? localFallback.write(key, value) : true
    }
    try {
      return await writeCloud(key, value)
    } catch (e) {
      console.error(`[cloud] 写 ${key} 抛错：`, e.message)
      return false
    }
  },

  async remove(key) {
    const spec = SPECS[key]
    if (!spec) return localFallback ? localFallback.remove(key) : undefined
    const userId = await currentUserId()
    if (!userId) return
    // 单行表按 user_id 删；其余表清空当前用户的行
    const col = spec.kind === 'single' || spec.kind === 'blob' ? 'user_id' : 'user_id'
    const { error } = await supabase.from(spec.table).delete().eq(col, userId)
    if (error) console.warn(`[cloud] 清 ${spec.table} 失败：`, error.message)
    snapshot.delete(key)
  },

  /** 备份：把当前用户在云端的全部数据导成和 localStorage 一样的结构。 */
  async readAll() {
    const out = {}
    for (const key of Object.keys(SPECS)) {
      try {
        const v = await readCloud(key)
        if (v != null && !(Array.isArray(v) && v.length === 0)) out[key] = v
      } catch (e) {
        console.warn(`[cloud] 备份时读 ${key} 失败：`, e.message)
      }
    }
    return out
  },

  /** 恢复：逐表覆盖写。 */
  async writeAll(snap) {
    let ok = true
    for (const [key, value] of Object.entries(snap || {})) {
      if (!SPECS[key]) continue
      const r = await this.write(key, value)
      if (!r) ok = false
    }
    return ok
  },

  async clearBusiness() {
    for (const key of [
      storageKeys.categories, storageKeys.bookmarks, storageKeys.sites,
      storageKeys.favorites, storageKeys.submissions, storageKeys.feedback,
      storageKeys.notes, storageKeys.visits,
    ]) {
      await this.remove(key)
    }
  },
}
