/* =========================================================================
   probe-realtime-patch.mjs —— 实时变更「判决逻辑」的纯函数守卫

   为什么值得进 CI（2026-10-31）：

     这段逻辑（`STATE_TARGET` / `sameLocalObject` / `applyPatch`）原来是
     `useRealtime.js` 里的私有函数，而那个文件 import 了 useStore / useSettings /
     supabase —— 裸 node 下一个都加载不起来，所以它**一行测试都没有**。

     它偏偏又是最需要钉的：`sameLocalObject` 判错一次，自己写的每一条回声
     都会被当成「远端变了」，UI 白刷一遍（列表重排、输入框失焦、动画重放）；
     `ids` 分支判错一次，收藏数会**重复计数**。

     现在它被抽到 `src/data/realtimePatch.js`（只依赖零 import 的 options.js），
     于是和 `probe-transfer.mjs` 一样能进 CI：不联网、不开浏览器、几十毫秒。

   跑法：node scripts/probe-realtime-patch.mjs

   分节：
     【1】sameLocalObject    等价判定（回声抑制的地基）
     【2】rows               增 / 改 / 删 / 回声 / 同步 session
     【3】ids                收藏 + 计数副作用
     【4】map                访问计数
     【5】single             分享设置
     【6】settings           设置（走注入，不碰 state）
     【7】边界              不认识的东西 / 字段缺失
     【8】STATE_TARGET 覆盖  别漏表（漏了是静默失效）
     【9】判别力自检        故意写错的实现，确认上面的断言真的会红
   ========================================================================= */

import { register } from 'node:module'

/* ⚠️ 必须在**动态** import 之前注册：静态 import 会在 register() 执行前
      就被解析掉，那时 hook 还没装。见 lib/alias-loader.mjs 的注释。 */
register('./lib/alias-loader.mjs', import.meta.url)

const { STATE_TARGET, applyPatch, sameLocalObject } = await import('../src/data/realtimePatch.js')
const { storageKeys } = await import('../src/data/options.js')

let pass = 0
let fail = 0
const failures = []

function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    failures.push(`${name}${detail ? `\n     ${detail}` : ''}`)
    console.log(`  ❌ ${name}${detail ? `  → ${detail}` : ''}`)
  }
}

const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`)

/** 一份最小的 state 骨架 —— 字段名必须和 `STATE_TARGET` 里的 `field` 对得上。 */
function makeState(patch = {}) {
  return {
    categories: [],
    bookmarks: [],
    notes: [],
    submissions: [],
    feedback: [],
    users: [],
    favorites: [],
    visits: {},
    share: null,
    session: null,
    ...patch,
  }
}

/** 记录副作用调用的桩。 */
function spy() {
  const calls = { settings: [], fav: [] }
  return {
    calls,
    hooks: {
      applySettings: (v) => {
        calls.settings.push(v)
        return true
      },
      onFavoriteChange: (id, d) => calls.fav.push([id, d]),
    },
  }
}

/* ====================================================================== */

console.log('\n【1】sameLocalObject —— 等价判定')

check('完全一样 → true', sameLocalObject({ a: 1 }, { a: 1 }) === true)
check('两个空对象 → true', sameLocalObject({}, {}) === true)

/**
 * 🔴 这是整个文件最重要的一条。
 *    `b` 比 `a` **多**一个键（DB 那边多出 `created_at` 这类我们从不读的列），
 *    仍然必须判「等价」—— 否则自己写的回声永远被判成「变了」，
 *    回声抑制直接失效，每次写都白刷一遍 UI。
 */
check(
  '🔴 b 多出 a 不认识的键 → 仍算等价（回声抑制的地基）',
  sameLocalObject({ id: 'b1', name: 'A' }, { id: 'b1', name: 'A', createdAt: '2026-10-31' }) === true,
)
check('a 有 b 没有的键 → 不等价（值从有到无是真变化）', sameLocalObject({ a: 1, b: 2 }, { a: 1 }) === false)
check('值不同 → 不等价', sameLocalObject({ a: 1 }, { a: 2 }) === false)
check('null 与 undefined 视为等价（都归一成 null）', sameLocalObject({ a: null }, {}) === true)
check('undefined 与缺失等价', sameLocalObject({ a: undefined }, {}) === true)
check("'' 与 null 不等价", sameLocalObject({ a: '' }, { a: null }) === false)
check('0 与 false 不等价', sameLocalObject({ a: 0 }, { a: false }) === false)
check('a 是 null → false', sameLocalObject(null, { a: 1 }) === false)
check('b 是 null → false', sameLocalObject({ a: 1 }, null) === false)
check('a 是 undefined → false', sameLocalObject(undefined, {}) === false)

/* ⚠️ 已知的粗糙处，**钉住契约**：值是对象时走 JSON.stringify，键顺序不同会判「不等」。
   当前所有模型都是扁平标量字段，不会命中；真出现嵌套对象时这是**假红**
   （代价只是多刷一次 UI，不丢数据），所以没上深比较。 */
check(
  '嵌套对象键顺序不同 → 判「不等」（已知粗糙处，见注释）',
  sameLocalObject({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } }) === false,
)

console.log('\n【2】rows —— 增 / 改 / 删 / 回声 / 同步 session')

{
  const st = makeState({ bookmarks: [{ id: 'b1', name: '旧' }] })
  const value = { id: 'b1', name: '旧', createdAt: '2026-10-31' }
  const changed = applyPatch(st, storageKeys.bookmarks, { op: 'upsert', id: 'b1', value })

  check('🔴 回声：内容一样 → 返回 false（不刷 UI）', changed === false)
  check(
    '🔴 回声：**连对象引用都没换**（换了 Vue 就会重渲染、输入框会失焦）',
    st.bookmarks[0] !== value && st.bookmarks[0].name === '旧',
  )
}

{
  const st = makeState({ bookmarks: [{ id: 'b1', name: '旧' }] })
  const value = { id: 'b1', name: '新' }
  check('真变化 → 返回 true', applyPatch(st, storageKeys.bookmarks, { op: 'upsert', id: 'b1', value }) === true)
  eq('真变化 → 就地替换', st.bookmarks, [{ id: 'b1', name: '新' }])
}

{
  const st = makeState()
  const value = { id: 'b9', name: '新来的' }
  check('新增 → 返回 true', applyPatch(st, storageKeys.bookmarks, { op: 'upsert', id: 'b9', value }) === true)
  eq('新增 → 追加到末尾', st.bookmarks, [{ id: 'b9', name: '新来的' }])
  check('新增 → 存进去的就是那个对象（没做无谓拷贝）', st.bookmarks[0] === value)
}

{
  const st = makeState({ bookmarks: [{ id: 'b1' }, { id: 'b2' }] })
  check('删除存在 → 返回 true', applyPatch(st, storageKeys.bookmarks, { op: 'remove', id: 'b1' }) === true)
  eq('删除存在 → 只删那一条', st.bookmarks, [{ id: 'b2' }])
  check('删除不存在 → 返回 false', applyPatch(st, storageKeys.bookmarks, { op: 'remove', id: 'zzz' }) === false)
}

{
  // profiles 的特殊之处：收到自己那行时，顶栏用的 state.session 也要跟着更新
  const st = makeState({
    users: [{ id: 'u1', nickname: '旧名' }],
    session: { id: 'u1', nickname: '旧名', token: 'tk' },
  })
  const ok = applyPatch(st, storageKeys.users, {
    op: 'upsert',
    id: 'u1',
    value: { id: 'u1', nickname: '新名' },
  })
  check('profiles 更新 → 返回 true', ok === true)
  eq('profiles 更新 → users 里改了', st.users, [{ id: 'u1', nickname: '新名' }])
  eq('🔴 profiles 更新 → session 也跟着改了', st.session, { id: 'u1', nickname: '新名', token: 'tk' })
  check('session 合并后 token 还在（不是整个换掉）', st.session.token === 'tk')
}

{
  const st = makeState({
    users: [{ id: 'u2', nickname: '旧名' }],
    session: { id: 'u1', nickname: '我' },
  })
  applyPatch(st, storageKeys.users, { op: 'upsert', id: 'u2', value: { id: 'u2', nickname: '别人' } })
  eq('别人的 profiles 行 → 不动我的 session', st.session, { id: 'u1', nickname: '我' })
}

{
  // 回声被抑制时**不会**顺带同步 session —— 因为 return false 在 syncSession 之前。
  // 钉住这个契约：正常路径下 session 是写操作自己维护的，轮不到回声来补。
  const st = makeState({
    users: [{ id: 'u1', nickname: '新名' }],
    session: { id: 'u1', nickname: '旧名' },
  })
  const ok = applyPatch(st, storageKeys.users, {
    op: 'upsert',
    id: 'u1',
    value: { id: 'u1', nickname: '新名', createdAt: '2026-10-31' },
  })
  check('profiles 回声 → 返回 false', ok === false)
  check('profiles 回声 → session 保持原样（不被回声修正）', st.session.nickname === '旧名')
}

console.log('\n【3】ids —— 收藏 + 计数副作用')

{
  const { calls, hooks } = spy()
  const st = makeState({ favorites: ['s1'] })

  check('收藏新增 → true', applyPatch(st, storageKeys.favorites, { op: 'upsert', id: 's2' }, hooks) === true)
  eq('收藏新增 → 数组里有了', st.favorites, ['s1', 's2'])
  eq('🔴 收藏新增 → 计数 +1（discover_sites 不在订阅里，只能手动跟）', calls.fav, [['s2', 1]])
}

{
  const { calls, hooks } = spy()
  const st = makeState({ favorites: ['s1'] })

  check('🔴 收藏回声（已存在）→ false', applyPatch(st, storageKeys.favorites, { op: 'upsert', id: 's1' }, hooks) === false)
  eq('🔴 收藏回声 → **不重复计数**', calls.fav, [])
  eq('收藏回声 → 数组没变', st.favorites, ['s1'])
}

{
  const { calls, hooks } = spy()
  const st = makeState({ favorites: ['s1', 's2'] })

  check('取消收藏 → true', applyPatch(st, storageKeys.favorites, { op: 'remove', id: 's1' }, hooks) === true)
  eq('取消收藏 → 数组少了它', st.favorites, ['s2'])
  eq('取消收藏 → 计数 -1', calls.fav, [['s1', -1]])
}

{
  const { calls, hooks } = spy()
  const st = makeState({ favorites: ['s1'] })
  check('取消不存在的收藏 → false', applyPatch(st, storageKeys.favorites, { op: 'remove', id: 'zz' }, hooks) === false)
  eq('取消不存在的收藏 → 不动计数', calls.fav, [])
}

console.log('\n【4】map —— 访问计数')

{
  const st = makeState({ visits: { b1: 3 } })
  check('新键 → true', applyPatch(st, storageKeys.visits, { op: 'upsert', id: 'b2', value: 1 }) === true)
  eq('新键 → 写进去了', st.visits, { b1: 3, b2: 1 })

  check('同值 → false（回声）', applyPatch(st, storageKeys.visits, { op: 'upsert', id: 'b1', value: 3 }) === false)
  check('改值 → true', applyPatch(st, storageKeys.visits, { op: 'upsert', id: 'b1', value: 4 }) === true)
  eq('改值 → 生效', st.visits.b1, 4)

  check('删除存在 → true', applyPatch(st, storageKeys.visits, { op: 'remove', id: 'b1' }) === true)
  check('删除后键没了', !('b1' in st.visits))
  check('删除不存在 → false', applyPatch(st, storageKeys.visits, { op: 'remove', id: 'zz' }) === false)
}

console.log('\n【5】single —— 分享设置')

{
  const st = makeState({ share: { slug: 'abc', enabled: true } })
  const value = { slug: 'xyz', enabled: true }
  check('分享设置变化 → true', applyPatch(st, storageKeys.share, { op: 'upsert', value }) === true)
  eq('分享设置 → 换上新的', st.share, { slug: 'xyz', enabled: true })
  check('换上的是**副本**，不是直接持有外部对象', st.share !== value)

  check('分享设置回声 → false', applyPatch(st, storageKeys.share, { op: 'upsert', value: { slug: 'xyz', enabled: true } }) === false)
  check('分享设置被删 → false（交给重读，不在这里猜默认态）', applyPatch(st, storageKeys.share, { op: 'remove' }) === false)
}

console.log('\n【6】settings —— 走注入，不碰 state')

{
  const { calls, hooks } = spy()
  const st = makeState()
  const value = { themeMode: 'Dark' }
  check('设置 upsert → 交给注入的 applySettings', applyPatch(st, storageKeys.settings, { op: 'upsert', value }, hooks) === true)
  eq('applySettings 收到了值', calls.settings, [{ themeMode: 'Dark' }])
}

{
  const st = makeState()
  const hooks = { applySettings: () => false } // 设置没变 = 自己写的回声
  check('设置回声（applySettings 返回 false）→ 整体 false', applyPatch(st, storageKeys.settings, { op: 'upsert', value: {} }, hooks) === false)
}

{
  const { calls, hooks } = spy()
  const st = makeState()
  check('设置被删 → false', applyPatch(st, storageKeys.settings, { op: 'remove' }, hooks) === false)
  eq('设置被删 → **不**去调 applySettings', calls.settings, [])
}

{
  const st = makeState()
  check('没注入 applySettings → false（不炸）', applyPatch(st, storageKeys.settings, { op: 'upsert', value: {} }, {}) === false)
}

console.log('\n【7】边界 —— 不认识的东西')

{
  const st = makeState()
  check('不认识的 key → false', applyPatch(st, 'jt:nonsense', { op: 'upsert', id: 'x', value: 1 }) === false)
  check('change 是 null → false（不炸）', applyPatch(st, storageKeys.bookmarks, null) === false)
  check('state 是 null → false（不炸）', applyPatch(null, storageKeys.bookmarks, { op: 'upsert', id: 'x', value: {} }) === false)
}

{
  // 字段还没读出来（reloadStore 之前就来事件了）—— 不能就地建一个，
  // 那会让「本机有、云端没有」的判断全错。返回 false 等下次重读。
  const st = makeState({ visits: null, share: undefined })
  check('state 字段是 null → false', applyPatch(st, storageKeys.visits, { op: 'upsert', id: 'b1', value: 1 }) === false)
  check('state 字段是 undefined → false', applyPatch(st, storageKeys.share, { op: 'upsert', value: { slug: 'a' } }) === false)
}

console.log('\n【8】STATE_TARGET 覆盖 —— 别漏表')

{
  /**
   * 漏一张表的失败模式是**静默**的：事件照收，`applyPatch` 直接 `return false`，
   * 界面什么都不变，日志里连一句都没有。所以这里钉住「除这三类之外都要有」：
   *   · session / seedVersion —— 只存在本机（cloud.js 的 LOCAL_ONLY）
   *   · sites —— 全局表，故意不订阅（会把每个人的每次浏览都广播出去）
   */
  const EXCLUDED = new Set([storageKeys.session, storageKeys.seedVersion, storageKeys.sites])
  const missing = Object.values(storageKeys)
    .filter((k) => !EXCLUDED.has(k))
    .filter((k) => !(k in STATE_TARGET))

  check(
    `除 session / seedVersion / sites 外，${Object.values(storageKeys).length - 3} 个键都在 STATE_TARGET 里`,
    missing.length === 0,
    missing.length ? `缺：${missing.join(', ')}` : '',
  )

  const extra = Object.keys(STATE_TARGET).filter((k) => !Object.values(storageKeys).includes(k))
  check('STATE_TARGET 里没有野键', extra.length === 0, extra.join(', '))

  const badKind = Object.entries(STATE_TARGET)
    .filter(([, t]) => !['rows', 'ids', 'map', 'single', 'settings'].includes(t.kind))
    .map(([k]) => k)
  check('每个 target 的 kind 都是已知的四种 + settings', badKind.length === 0, badKind.join(', '))

  const badField = Object.entries(STATE_TARGET)
    .filter(([, t]) => t.kind !== 'settings' && !t.field)
    .map(([k]) => k)
  check('非 settings 的 target 都必须有 field', badField.length === 0, badField.join(', '))
}

console.log('\n【9】判别力自检 —— 上面那些断言真的会红吗')

{
  /**
   * 把 `sameLocalObject` 换成「比较整个对象」的**朴素实现**。
   * 它看起来更「严谨」，实际上会把每一条回声都判成变化。
   * 如果上面那条 🔴 断言连这个都能放行，说明那条断言是废的。
   */
  const naive = (a, b) => {
    if (!a || !b) return false
    return JSON.stringify(a) === JSON.stringify(b)
  }
  const a = { id: 'b1', name: 'A' }
  const b = { id: 'b1', name: 'A', createdAt: '2026-10-31' }

  check('朴素实现（比整个对象）会把回声误判成「变了」', naive(a, b) === false)
  check('所以【1】那条 🔴 断言确实有判别力（两种实现结论相反）', naive(a, b) !== sameLocalObject(a, b))
}

{
  /**
   * 把 `ids` 分支写成「不查 indexOf，直接 push」。
   * 它会让每一条收藏回声都重复追加一条，收藏数也会重复 +1。
   */
  const brokenIds = (st, change) => {
    st.favorites.push(change.id)
    return true
  }
  const st = makeState({ favorites: ['s1'] })
  const got = brokenIds(st, { op: 'upsert', id: 's1' })
  check('错实现（不查重）会把已存在的 id 再追加一条', got === true && st.favorites.length === 2)

  const st2 = makeState({ favorites: ['s1'] })
  check(
    '所以【3】那条 🔴「回声 → false 且不重复计数」确实有判别力',
    applyPatch(st2, storageKeys.favorites, { op: 'upsert', id: 's1' }, spy().hooks) === false &&
      st2.favorites.length === 1,
  )
}

/* ====================================================================== */

console.log(`\n${'='.repeat(60)}`)
console.log(`通过 ${pass} / 失败 ${fail}`)
if (fail) {
  console.log('失败项：')
  for (const f of failures) console.log('  · ' + f)
}
process.exit(fail ? 1 : 0)
