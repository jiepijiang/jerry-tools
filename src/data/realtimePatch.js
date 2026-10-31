/* =========================================================================
   实时变更 → state 的**判决逻辑**（纯函数，零外部依赖）
   -------------------------------------------------------------------------
   为什么单独拆出来（2026-10-31）：

     这段逻辑原来长在 `useRealtime.js` 里，而那个文件 import 了 useStore /
     useSettings / supabase —— 任何一个在裸 node 下都加载不起来（`import.meta.env`
     在 node 里是 undefined，`localStorage` 更不存在）。
     结果就是：**全项目最该被钉住的一段判断，一行测试都没有**。

     但它其实只依赖 `storageKeys`（一个零 import 的常量表）：
     把 `state` 和两个副作用（应用设置 / 收藏计数）**从参数传进来**，
     它立刻变成纯函数，能像 `transfer.js` 那样进 CI。

   职责边界：
     - 这里**只**决定「往 state 上打什么补丁、以及打完之后算不算真的变了」。
     - 不碰 supabase、不碰 localStorage、不认识 Vue 的响应式。
     - `state` 由调用方给，副作用由调用方注入。

   ⚠️ 返回值 `true/false` 的语义是「**是否真的改了**」：
      `false` 绝大多数情况是**自己写下去的回声**（服务端原样回推一份），
      调用方据此不计数、不刷 UI。这不是「失败」。
   ========================================================================= */

import { storageKeys } from '@/data/options'

/**
 * storageKey → 落到 state 的哪个字段、按哪种结构应用。
 *
 * ⚠️ `settings` 的 field 是 null —— 它**不在 state 上**，
 *    归 useSettings 的 reactive 对象管，走注入的 `applySettings` 单独处理。
 *
 * ⚠️ 这张表必须和 `adapters/cloud.js` 的 `SPECS` 保持一一对应
 *    （`SPECS` 里除了全局表 `discover_sites`，其余都在这里）。
 *    漏一个的失败模式是**静默**的：事件照收，`applyPatch` 直接 `return false`，
 *    界面什么都不变，日志里连一句都没有。
 */
export const STATE_TARGET = {
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

/**
 * 两个本地模型对象在「应用已经认识的字段」上是否等价。
 *
 * ⚠️ **只比 `a` 的键**，而且这一条是整个回声抑制的地基。
 *    理由：`a` 是 state 里的对象，它的键就是应用在用的字段。
 *    DB 那边可能多出 `created_at` 这类我们从不读的列，
 *    把它们算进差异的话，自己写的回声会**永远**被判成「变了」，
 *    回声抑制直接失效 —— 表现是每次写都白刷一遍 UI。
 *
 * ⚠️ 已知的粗糙处（有意保留）：值是对象时走 `JSON.stringify` 比较，
 *    键顺序不同会被判成「不等」。当前所有模型都是扁平的标量字段，
 *    不会命中；真出现嵌套对象时应该换成深比较 —— 但那是**假红**，
 *    代价只是多刷一次 UI，不会丢数据，所以不值得现在上深比较。
 */
export function sameLocalObject(a, b) {
  if (!a || !b) return false
  for (const k of Object.keys(a)) {
    const va = a[k] === undefined ? null : a[k]
    const vb = b[k] === undefined ? null : b[k]
    if (JSON.stringify(va) !== JSON.stringify(vb)) return false
  }
  return true
}

/**
 * 把一条变更落到 `state` 上。返回「是否真的改了」（false = 被回声抑制掉了）。
 *
 * @param {object} state   调用方的 state（本模块只按 `STATE_TARGET.field` 取值）
 * @param {string} key     storageKey
 * @param {object} change  `{ op:'upsert'|'remove', id?, value? }`（由 applyRemoteChange 产出）
 * @param {object} hooks
 *   - `applySettings(value)`      应用设置，返回是否真的改了。**不能**落盘，
 *                                 否则「收到事件 → 再写一次 → 又触发事件」无限回环。
 *   - `onFavoriteChange(id, ±1)`  收藏数跟着动一下（`discover_sites` 不在实时订阅里）
 */
export function applyPatch(state, key, change, hooks = {}) {
  const target = STATE_TARGET[key]
  if (!target) return false
  if (!change) return false

  /* ---------------------------------------------------------- settings
   * 这条分支**不碰 state** —— 设置活在 useSettings 的 reactive 对象里。
   * 删除（`op === 'remove'`）返回 false：单行表被删等于回到默认态，
   * 那种情况交给全量重读更稳妥。
   */
  if (target.kind === 'settings') {
    if (change.op !== 'upsert') return false
    return hooks.applySettings ? !!hooks.applySettings(change.value) : false
  }

  const cur = state ? state[target.field] : null
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
        // ← 这里就是回声抑制：内容一样就什么都不做（**不替换引用**，
        //   否则列表会重排、输入框会失焦、动画会重放）
        if (sameLocalObject(cur[i], change.value)) return false
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
        // 收藏数挂在 discover_sites 上，而那张表不在实时订阅里（全局表，
        // 订阅它会把每个人的每次浏览都广播出去）—— 所以这里手动跟着动一下。
        // 放在 return false 之后，所以**自己写的回声不会重复计数**。
        if (key === storageKeys.favorites) hooks.onFavoriteChange?.(change.id, -1)
        return true
      }
      if (i >= 0) return false
      cur.push(change.id)
      if (key === storageKeys.favorites) hooks.onFavoriteChange?.(change.id, +1)
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
