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
      👉 这条判据由 `scripts/probe-realtime-live.mjs` 执行（2026-10-26，24 条断言）：
         两个浏览器上下文登同一账号，A 直接 REST 插/删一行，断言 B 不刷新就跟着变。
         在这之前它只存在于注释里 —— 等于没人知道线上到底通不通。

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
import { REALTIME_TABLES, applyRemoteChange } from '@/data/adapters/cloud'
import { applyPatch, belongsToMe } from '@/data/realtimePatch'
import { state, reloadStore, bumpSiteCollects } from '@/composables/useStore'
import { applyRemoteSettings } from '@/composables/useSettings'

/**
 * 判决逻辑（`STATE_TARGET` / `sameLocalObject` / `applyPatch`）已经挪到
 * `src/data/realtimePatch.js` —— 那个文件零外部依赖，能进 CI。
 *
 * 这里只留「把副作用接到谁身上」这件事：设置归 useSettings、收藏计数归 useStore。
 * ⚠️ `applyRemoteSettings` 只能改内存 + 刷 `<html>`，**绝不能落盘** ——
 *    落盘会再触发一次云端写入，于是「收到事件 → 又写一次 → 又收到事件」无限回环。
 */
const PATCH_HOOKS = {
  applySettings: applyRemoteSettings,
  onFavoriteChange: bumpSiteCollects,
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

/**
 * 重连退避上限：1s → 2s → 4s → … → 最多 30s，试满 6 次就不再自己重试。
 *
 * ⚠️ 「不再自己重试」**不等于同步永久死掉** —— 2026-10-26 实测过：
 *    放弃之后日志里会紧跟着一条 `全量重读（重连）`。救回来的是
 *    **supabase-js 自己的重连**（客户端内部一直按自己的退避重连 socket），
 *    它重连成功会把 `SUBSCRIBED` 再抛一次，被下面的 `onStatus` 接住，
 *    于是状态回绿、`resync` 照跑。
 *
 *    换句话说这层退避是**叠加在库自带的之上**的，作用是
 *    「我们主动重建 channel」这条路有上限，别在服务端真挂时白刷日志；
 *    它不是唯一命脉。**别照着「放弃 = 死了」去改这里。**
 *    验证见 `scripts/probe-realtime-live.mjs` 第 ⑥ 节（故意断线 100 秒再放行）。
 */
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

/* -------------------------------------------------------- 应用到 state */

/**
 * 把一条变更落到 state 上。返回「是否真的改了」（false = 被回声抑制掉了）。
 *
 * 真正的判决逻辑在 `@/data/realtimePatch`（纯函数、有 CI 探针钉着），
 * 这里只是把它和两个副作用接起来 —— 别把逻辑写回这个文件，
 * 写回来就又测不了了。
 */
function applyChange(key, change) {
  return applyPatch(state, key, change, PATCH_HOOKS)
}

/* -------------------------------------------------------------- 事件入口 */

function handleChange(key, payload) {
  const eventType = payload.eventType // INSERT | UPDATE | DELETE
  const row = payload.new
  const oldRow = payload.old

  // DELETE 的 old 只有主键列，没法判归属 —— 靠 filter + RLS 兜着
  if (eventType !== 'DELETE' && row && !belongsToMe(key, row, currentUid)) return

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
    // ⚠️ 措辞别写成「实时同步停用」—— 见 MAX_RETRY 的注释：库自己还会重连，
    //    实测这之后通常几秒内就会收到 SUBSCRIBED 并自动恢复。
    console.warn('[realtime] 自己不再重建 channel，交给底层客户端重连（若久不恢复再刷新页面）')
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
