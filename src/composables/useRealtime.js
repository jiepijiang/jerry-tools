/* =========================================================================
   实时多端同步（Supabase Realtime / postgres_changes）
   -------------------------------------------------------------------------
   登录后订阅自己那些表的变更，另一台设备的改动**不用刷新**就会出现在这里。

   设计上有三处是刻意的，踩过才知道：

   1. **订阅状态不等于「能收到事件」。**
      `subscribe()` 返回 `SUBSCRIBED` 只说明 websocket 连上了。
      如果表不在 `supabase_realtime` 发布里，状态照样是 `SUBSCRIBED`，
      然后**一条事件都收不到** —— 实测连一个根本不存在的表名都是 `SUBSCRIBED`。
      所以别拿订阅状态当验证，唯一可靠的判据是「写一行 → 看有没有事件」。

   2. **自己写的东西会被服务端原样回推一份。**
      不处理的话每次写都要白刷一遍 UI（列表重排、输入框失焦、动画重放）。
      这里的做法是**幂等应用**：拿到变更先和 `state` 里的现值比，
      一样就什么都不做。比「记住自己写过哪些 id 再过滤掉」可靠得多 ——
      后者要考虑时间窗、并发写、失败重试，很容易漏。

   3. **断线期间的事件是补不回来的。**
      postgres_changes 没有回放。所以**每次重连后必须做一次全量重读**，
      否则那段时间别的设备改的东西永远同步不过来。
      另外后台标签页的 websocket 会被浏览器节流甚至掐断，
      切回来时也要检查一下连接是否还活着。
   ========================================================================= */

import { reactive } from 'vue'
import { supabase, supabaseConfigured } from '@/data/supabase'
import { storageKeys } from '@/data/options'
import { REALTIME_TABLES, applyRemoteChange } from '@/data/adapters/cloud'
import { state, reloadStore } from '@/composables/useStore'
import { applyRemoteSettings } from '@/composables/useSettings'

/**
 * storageKey → 落到 state 的哪个字段、按哪种结构应用。
 *
 * ⚠️ `settings` 的 field 是 null —— 它**不在 state 上**，
 *    归 useSettings 的 reactive 对象管，走 applyRemoteSettings 单独处理。
 */
const STATE_TARGET = {
  [storageKeys.categories]: { field: 'categories', kind: 'rows' },
  [storageKeys.bookmarks]: { field: 'bookmarks', kind: 'rows' },
  [storageKeys.notes]: { field: 'notes', kind: 'rows' },
  [storageKeys.submissions]: { field: 'submissions', kind: 'rows' },
  [storageKeys.feedback]: { field: 'feedback', kind: 'rows' },
  // profiles：收到的若是自己那行，顺手把 state.session 也同步了，
  // 否则在另一台设备改了昵称，这台顶栏还是旧的
  [storageKeys.users]: { field: 'users', kind: 'rows', syncSession: true },
  [storageKeys.favorites]: { field: 'favorites', kind: 'ids' },
  [storageKeys.visits]: { field: 'visits', kind: 'map' },
  [storageKeys.share]: { field: 'share', kind: 'single' },
  [storageKeys.settings]: { field: null, kind: 'settings' },
}

/** 供 UI 显示同步状态。 */
export const realtimeStatus = reactive({
  /** off | connecting | live | error */
  state: 'off',
  /** 'not_enabled' = 服务端没把表加进 supabase_realtime 发布（要跑迁移）；其余是原始报错 */
  error: '',
  /** 最近一次真正应用到 state 的时间戳（回声不算） */
  lastEventAt: 0,
  /** 本次会话里应用了多少条远端变更 —— 排查「到底有没有在工作」时很有用 */
  applied: 0,
})

/** 重连退避上限：1s → 2s → 4s → … → 最多 30s，试满就放弃。 */
const MAX_RETRY = 6

let channel = null
let currentUid = null
/** 已经连上过至少一次 —— 用来区分「首次连接」和「断线重连」。 */
let hadConnection = false
let retry = 0
let retryTimer = null
let seq = 0
/** 用户是否还要保持订阅。stopRealtime 会置 false，用来屏蔽旧 channel 的迟到回调。 */
let active = false
let resyncing = false
/**
 * 服务端明确拒绝了订阅（表没进 publication）。
 *
 * ⚠️ 这个标记**必须**有，因为服务端是这么干的：
 *    先用 `system` 事件报「Unable to subscribe to changes...」，
 *    **紧接着** `subscribe()` 仍然回调 `SUBSCRIBED`。
 *    不挡一下的话，状态会被后到的 SUBSCRIBED 覆盖成绿色「同步中」——
 *    界面显示一切正常，实际一条都收不到。这比报错更糟。
 */
let channelBroken = false

/* ------------------------------------------------------------ 状态判定 */

/** 这一行是不是当前用户的。过滤列配错时的第二道防线（第一道是 RLS）。 */
function belongsToMe(key, row) {
  if (key === storageKeys.users) return row.id === currentUid
  return row.user_id === currentUid
}

/** 两个本地模型对象在「应用已经认识的字段」上是否等价。 */
function sameLocalObject(a, b) {
  if (!a || !b) return false
  /**
   * 只比 `a` 的键。理由：`a` 是 state 里的对象，它的键就是应用在用的字段。
   * DB 那边可能多出 `created_at` 这类我们从不读的列，
   * 把它们算进差异的话，自己写的回声会**永远**被判成「变了」，回声抑制直接失效。
   */
  for (const k of Object.keys(a)) {
    const va = a[k] === undefined ? null : a[k]
    const vb = b[k] === undefined ? null : b[k]
    if (JSON.stringify(va) !== JSON.stringify(vb)) return false
  }
  return true
}

/* -------------------------------------------------------- 应用到 state */

/** 把一条变更落到 state 上。返回「是否真的改了」（false = 被回声抑制掉了）。 */
function applyChange(key, change) {
  const target = STATE_TARGET[key]
  if (!target) return false

  if (target.kind === 'settings') {
    return change.op === 'upsert' ? applyRemoteSettings(change.value) : false
  }

  const cur = state[target.field]
  if (cur == null) return false

  switch (target.kind) {
    case 'rows': {
      const i = cur.findIndex((x) => x.id === change.id)
      if (change.op === 'remove') {
        if (i < 0) return false
        cur.splice(i, 1)
        return true
      }
      if (i < 0) {
        cur.push(change.value)
      } else {
        if (sameLocalObject(cur[i], change.value)) return false // ← 自己写的回声
        cur[i] = change.value
      }
      if (target.syncSession && state.session?.id === change.value?.id) {
        state.session = { ...state.session, ...change.value }
      }
      return true
    }

    case 'ids': {
      const i = cur.indexOf(change.id)
      if (change.op === 'remove') {
        if (i < 0) return false
        cur.splice(i, 1)
        return true
      }
      if (i >= 0) return false
      cur.push(change.id)
      return true
    }

    case 'map': {
      if (change.op === 'remove') {
        if (!(change.id in cur)) return false
        delete cur[change.id]
        return true
      }
      if (cur[change.id] === change.value) return false
      cur[change.id] = change.value
      return true
    }

    case 'single': {
      // 单行表被删 = 回到默认态。这种情况少见，交给重读更稳妥
      if (change.op === 'remove') return false
      if (sameLocalObject(cur, change.value)) return false
      state.share = { ...change.value }
      return true
    }

    default:
      return false
  }
}

/* -------------------------------------------------------------- 事件入口 */

function handleChange(key, payload) {
  const eventType = payload.eventType // INSERT | UPDATE | DELETE
  const row = payload.new
  const oldRow = payload.old

  // DELETE 的 old 只有主键列，没法判归属 —— 靠 filter + RLS 兜着
  if (eventType !== 'DELETE' && row && !belongsToMe(key, row)) return

  const change = applyRemoteChange(key, eventType, row, oldRow)
  if (!change) return

  if (change.op === 'reload') {
    /**
     * 快照缺失（比如刚登录还没读完）—— 别就地建快照，全量读一次。
     * ⚠️ 日志**必须带上 key**：只说「快照缺失」没法定位是哪张表没读过。
     *    （踩过：user_settings 就是这样 —— initSettings 只在启动时跑过一次，
     *      那时还是本地模式，切到云端后没人再读，于是别人一改设置就全量重读。）
     */
    resync(`快照缺失:${key}`)
    return
  }

  if (applyChange(key, change)) {
    realtimeStatus.applied++
    realtimeStatus.lastEventAt = Date.now()
  }
}

/* ---------------------------------------------------------------- 重读 */

/**
 * 全量重读。**重连后必须做** —— 断线期间的事件补不回来。
 * 加锁是因为重连风暴可能连续触发多次，没必要读好几遍。
 */
async function resync(reason) {
  if (!active || resyncing) return
  resyncing = true
  try {
    console.log(`[realtime] 全量重读（${reason}）`)
    await reloadStore()
  } catch (e) {
    console.warn('[realtime] 重读失败：', e.message)
  } finally {
    resyncing = false
  }
}

/* ------------------------------------------------------------ 连接管理 */

function onStatus(ch, status, err) {
  // 旧 channel 的迟到回调（removeChannel 也会触发 CLOSED），直接丢
  if (ch !== channel || !active) return

  if (status === 'SUBSCRIBED') {
    // 已经被服务端拒过就别翻绿 —— 见 channelBroken 的注释
    if (channelBroken) return
    const reconnected = hadConnection
    hadConnection = true
    retry = 0
    realtimeStatus.state = 'live'
    realtimeStatus.error = ''
    if (reconnected) resync('重连')
    return
  }

  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
    realtimeStatus.state = 'error'
    realtimeStatus.error = err?.message || status
    scheduleRetry()
  }
}

/**
 * 服务端对 postgres_changes 订阅的**唯一**反馈渠道。
 *
 * ⚠️ 表不在 publication 里时，`subscribe()` 依然回调 `SUBSCRIBED`，
 *    真正的报错只从这里出来。不接这个事件就只能靠「怎么不生效」来发现。
 */
function onSystem(ch, payload) {
  if (ch !== channel || !active) return
  if (payload?.status !== 'error') return

  channelBroken = true
  realtimeStatus.state = 'error'
  realtimeStatus.error = 'not_enabled'

  console.error(
    '[realtime] 服务端拒绝了 postgres_changes 订阅：\n' +
      `  ${payload.message}\n` +
      '多半是这些表没加进 supabase_realtime 发布。跑一次：\n' +
      '  supabase/migrations/003-realtime.sql\n' +
      '⚠️ 注意：此时 subscribe() 仍会报 SUBSCRIBED，别被它骗了。',
  )
  // 这是服务端配置问题，重试一万次也一样 —— 不要进退避循环白刷日志
}

function scheduleRetry() {
  // 服务端配置问题重试无意义（见 onSystem）
  if (!active || retryTimer || channelBroken) return
  if (retry >= MAX_RETRY) {
    realtimeStatus.error = 'reconnect_giveup'
    console.warn('[realtime] 重连次数用尽，实时同步停用。刷新页面可重试。')
    return
  }
  const delay = Math.min(30000, 1000 * 2 ** retry)
  retry++
  retryTimer = setTimeout(() => {
    retryTimer = null
    rebuild('退避重连')
  }, delay)
}

function buildChannel() {
  const ch = supabase.channel(`jt-sync-${currentUid}-${++seq}`)
  channel = ch
  channelBroken = false

  for (const { key, table, filterColumn } of REALTIME_TABLES) {
    ch.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `${filterColumn}=eq.${currentUid}` },
      (payload) => {
        if (ch !== channel) return
        handleChange(key, payload)
      },
    )
  }

  ch.on('system', {}, (payload) => onSystem(ch, payload))
  ch.subscribe((status, err) => onStatus(ch, status, err))
}

async function rebuild(reason) {
  if (!active) return
  const old = channel
  channel = null
  if (old) {
    try {
      await supabase.removeChannel(old)
    } catch {
      /* 旧 channel 已经烂掉了，删不掉也无所谓 */
    }
  }
  if (!active) return
  console.log(`[realtime] 重新订阅（${reason}）`)
  realtimeStatus.state = 'connecting'
  buildChannel()
}

/* ------------------------------------------------------------ 可见性 */

/**
 * 切回前台时检查连接。
 *
 * 后台标签页的 websocket 会被浏览器节流甚至掐断，而 `SUBSCRIBED` 状态
 * 未必及时更新 —— 表现是「切回来看着是好的，但再也不同步了」。
 * 这里只在**确实不在线**时才重建，正常切标签不会白跑。
 */
function onVisibility() {
  if (!active || document.visibilityState !== 'visible') return
  if (channel && channel.state === 'joined') return
  rebuild('回到前台')
}

/* ------------------------------------------------------------ 对外接口 */

/** 登录后调。重复调用是幂等的（会先把旧的拆掉）。 */
export function startRealtime(uid) {
  if (!supabaseConfigured || !supabase || !uid) return false
  stopRealtime()
  active = true
  currentUid = uid
  hadConnection = false
  retry = 0
  realtimeStatus.state = 'connecting'
  realtimeStatus.error = ''
  realtimeStatus.applied = 0
  document.addEventListener('visibilitychange', onVisibility)
  buildChannel()
  return true
}

/** 退出登录 / 切回本地模式时调。 */
export function stopRealtime() {
  active = false
  currentUid = null
  hadConnection = false
  retry = 0
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  document.removeEventListener('visibilitychange', onVisibility)

  const old = channel
  channel = null
  if (old && supabase) {
    Promise.resolve(supabase.removeChannel(old)).catch(() => {})
  }
  realtimeStatus.state = 'off'
  realtimeStatus.error = ''
}

/** 手动补一次全量读（调试 / 兜底用）。 */
export function resyncNow() {
  return resync('手动')
}

/** 当前是否在实时同步中。 */
export function isRealtimeLive() {
  return realtimeStatus.state === 'live'
}
