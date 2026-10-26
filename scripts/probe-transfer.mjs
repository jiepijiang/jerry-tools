/* =========================================================================
   probe-transfer.mjs —— 「本机 ↔ 云端」数据搬运的纯逻辑守卫

   为什么值得进 CI（2026-10-26）：

     这是全项目**唯一会丢用户数据**的纯逻辑。`transfer.js` 的注释里引用过
     一份验证脚本 `/tmp/jerry-sb/transfer-verify.mjs` —— 那是 `/tmp` 里的
     一次性脚本，早就没了。也就是说这套合并逻辑当初是验过的，但验证没留下，
     之后任何人改它都是裸奔。

     它同时是**唯一能低成本进 CI 的**：全是纯函数，依赖只有 options.js 和
     helpers.js（这两个都零 import）。`@/` 别名由 lib/alias-loader.mjs 解决。

   跑法：node probe-transfer.mjs      （不需要浏览器、不需要构建、不联网）

   分节：
     【1】normalizeStorageKey   键名归一化
     【2】isKnownStorageKey     认不认识这个键
     【3】normalizeSnapshot     外部文件 → 只含认识的键
     【4】mergeCategories       分类并集
     【5】mergeBookmarks        书签并集（按 URL，且有 id 撞车保护）
     【6】planTransfer          汇总
     【7】判别力自检
   ========================================================================= */

import { register } from 'node:module'

/* ⚠️ 必须在**动态** import 之前注册：静态 import 会在 register() 执行前
      就被解析掉，那时 hook 还没装。见 lib/alias-loader.mjs 的注释。 */
register('./lib/alias-loader.mjs', import.meta.url)

const {
  isKnownStorageKey,
  mergeBookmarks,
  mergeCategories,
  mergeNotes,
  normalizeSnapshot,
  normalizeStorageKey,
  planTransfer,
} = await import('../src/data/transfer.js')
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

/** 深比较（这些值都是 JSON 形状，够用）。 */
function eq(name, got, want) {
  const a = JSON.stringify(got)
  const b = JSON.stringify(want)
  check(name, a === b, a === b ? '' : `期望 ${b}，实际 ${a}`)
}

console.log('\n【1】normalizeStorageKey —— 键名归一化')

eq("'categories' → 'jt:categories'", normalizeStorageKey('categories'), 'jt:categories')
eq("'jt:categories' 原样返回", normalizeStorageKey('jt:categories'), 'jt:categories')
eq("'' → ''", normalizeStorageKey(''), '')
eq('null → \'\'', normalizeStorageKey(null), '')
eq("undefined → ''", normalizeStorageKey(undefined), '')
// 边界：只有前缀、没有名字。认不认识是【2】的事，这里只管补前缀
eq("'jt:' 不重复补前缀", normalizeStorageKey('jt:'), 'jt:')

console.log('\n【2】isKnownStorageKey —— 认不认识这个键')

check("'categories' 认识", isKnownStorageKey('categories') === true)
check("'jt:bookmarks' 认识", isKnownStorageKey('jt:bookmarks') === true)
check("'nonsense' 不认识", isKnownStorageKey('nonsense') === false)
check("'jt:nonsense' 不认识", isKnownStorageKey('jt:nonsense') === false)
check("'' 不认识", isKnownStorageKey('') === false)
check(
  `storageKeys 里全部 ${Object.keys(storageKeys).length} 个键都认识`,
  Object.values(storageKeys).every((k) => isKnownStorageKey(k)),
  Object.values(storageKeys).filter((k) => !isKnownStorageKey(k)).join(', '),
)

console.log('\n【3】normalizeSnapshot —— 外部文件 → 只含认识的键')

eq('null → null（一个键都没有）', normalizeSnapshot(null), null)
eq('{} → null', normalizeSnapshot({}), null)
eq('{nonsense: 1} → null', normalizeSnapshot({ nonsense: 1 }), null)
eq("'string' 输入 → null", normalizeSnapshot('string'), null)
eq('{bookmarks: []} → 补前缀', normalizeSnapshot({ bookmarks: [] }), { 'jt:bookmarks': [] })
eq(
  '{bookmarks:[], categories:[]} 两个都留',
  normalizeSnapshot({ bookmarks: [], categories: [] }),
  { 'jt:bookmarks': [], 'jt:categories': [] },
)
eq(
  '{bookmarks:[], nonsense:1} 只留认识的',
  normalizeSnapshot({ bookmarks: [], nonsense: 1 }),
  { 'jt:bookmarks': [] },
)

/*
 * ⚠️ 这一条钉的是**当前契约**，不是「期望的行为」：
 *    `normalizeSnapshot` 只校验**键名**、不校验**值的形状**。
 *    所以 `{bookmarks: {a:1}}`（本该是数组）会被原样放行。
 *
 *    兜底在**下游**：`useStore.readTyped()` 把形状不对归成 `unreadable`，
 *    于是「下次启动不用种子顶掉」（用户刚恢复的坏数据不会二次消失）。
 *
 *    如果哪天有人给这里加了形状校验，这条会红 —— 那是对的：
 *    提醒他下游 `readTyped` 那条 `bad_shape` 分支的语义要一起改。
 */
eq(
  '{bookmarks: {a:1}} 形状错也放行（下游 readTyped 兜）',
  normalizeSnapshot({ bookmarks: { a: 1 } }),
  { 'jt:bookmarks': { a: 1 } },
)

console.log('\n【4】mergeCategories —— 分类并集（云端权威，本机只补缺）')

{
  const r = mergeCategories([], [{ id: 'a' }, { id: 'b' }])
  check('云端空 → 本机全补上', r.added === 2 && r.skipped === 0 && r.rows.length === 2)
}
{
  const r = mergeCategories([{ id: 'a' }], [{ id: 'a' }, { id: 'b' }])
  check('id 重复 → 跳过', r.added === 1 && r.skipped === 1 && r.rows.length === 2)
}
{
  const r = mergeCategories([{ id: 'a' }], [{ name: '没有 id' }])
  check('本机缺 id → 跳过', r.added === 0 && r.skipped === 1)
}
{
  // 云端是权威：同 id 时**不能**用本机的旧名字盖回去（可能刚在另一台设备改过）
  const r = mergeCategories([{ id: 'a', name: '云端' }], [{ id: 'a', name: '本机' }])
  check('同 id 保留云端的值', r.rows[0].name === '云端', `实际 ${r.rows[0]?.name}`)
}
{
  const r = mergeCategories(null, null)
  check('两边都是 null 不抛错', r.added === 0 && r.rows.length === 0)
}

console.log('\n【5】mergeBookmarks —— 书签并集（按 URL，且有 id 撞车保护）')

{
  const r = mergeBookmarks([], [{ id: '1', url: 'https://a.com' }])
  check('云端空 → 本机补上', r.added === 1 && r.rows.length === 1)
}
{
  // bookmarkKey 会补协议 + 去尾斜杠 + 小写，所以这两种写法是同一个站点
  const r = mergeBookmarks(
    [{ id: '1', url: 'https://a.com' }],
    [{ id: '2', url: 'https://A.com/' }],
  )
  check('同 URL（大小写 / 尾斜杠不同）→ 跳过', r.added === 0 && r.skipped === 1)
}
{
  // id 相同但 URL 不同 → upsert 会按 (user_id, id) 覆盖云端那行，是静默改数据
  const r = mergeBookmarks(
    [{ id: '1', url: 'https://a.com' }],
    [{ id: '1', url: 'https://b.com' }],
  )
  check('id 撞车但 URL 不同 → 宁可丢掉本机这条', r.added === 0 && r.skipped === 1)
}
{
  const r = mergeBookmarks([], [{ id: '1', url: '' }])
  check('空 URL → 跳过', r.added === 0 && r.skipped === 1)
}
{
  const r = mergeBookmarks(
    [],
    [{ id: '1', url: 'https://a.com' }, { id: '2', url: 'https://a.com/' }],
  )
  check('本机自己内部重复 URL → 只进一条', r.added === 1 && r.skipped === 1)
}
{
  /*
   * ⚠️ 这一条是**边界探测**：两条都**没有 id**、URL 不同。
   *
   * `mergeBookmarks` 只检查了 `!b?.url`，**没检查 `b.id`** ——
   * 于是第一条会把 `undefined` 塞进 `byId`，第二条 `byId.has(undefined)`
   * 命中 → 被当成「id 撞车」跳过。
   *
   * 期望：两条都该进（它们 URL 不同，不冲突）。
   */
  const r = mergeBookmarks([], [{ url: 'https://c.com' }, { url: 'https://d.com' }])
  check(
    '两条都缺 id、URL 不同 → 都该进（id 是 undefined 不该被当成撞车）',
    r.added === 2,
    `实际 added=${r.added}（说明 undefined 被当成同一个 id 了）`,
  )
}
{
  const r = mergeBookmarks(null, null)
  check('两边都是 null 不抛错', r.added === 0 && r.rows.length === 0)
}

console.log('\n【6】planTransfer —— 汇总')

{
  const p = planTransfer({}, {})
  check('全空 → added 0 / changed false', p.added === 0 && p.skipped === 0 && p.changed === false)
}
{
  const p = planTransfer({}, { categories: [{ id: 'a' }] })
  check(
    '只加一个分类 → changed true 且只有 categories 带 changed',
    p.changed === true &&
      p.categories.changed === true &&
      p.bookmarks.changed === false &&
      p.notes.changed === false,
  )
}
{
  const p = planTransfer(
    { bookmarks: [{ id: '1', url: 'https://a.com' }] },
    {
      categories: [{ id: 'c1' }],
      bookmarks: [{ id: '2', url: 'https://a.com/' }], // 重复
      notes: [{ id: 'n1' }],
    },
  )
  check('三类合计：added 2 / skipped 1', p.added === 2 && p.skipped === 1, `实际 added=${p.added} skipped=${p.skipped}`)
}
{
  // 便签复用分类的逻辑，这里确认真的接上了（而不是返回空）
  const p = planTransfer({}, { notes: [{ id: 'n1' }, { id: 'n2' }] })
  check('notes 走的是同一套并集逻辑', p.notes.added === 2 && p.notes.rows.length === 2)
}

console.log('\n【7】判别力自检')

/*
 * 写一个**故意错**的合并实现（只按 id 去重、不管 URL），
 * 证明上面【5】里那条「同 URL 跳过」不是「怎么写都能过」。
 */
function naiveMergeBookmarks(cloudRows, localRows) {
  const rows = [...(cloudRows || [])]
  const seen = new Set(rows.map((b) => b.id))
  for (const b of localRows || []) {
    if (!b?.url || seen.has(b.id)) continue
    seen.add(b.id)
    rows.push(b)
  }
  return { rows }
}
{
  const cloud = [{ id: '1', url: 'https://a.com' }]
  const local = [{ id: '2', url: 'https://A.com/' }]
  check(
    '只按 id 去重的实现会漏掉 URL 重复（真实现不会）',
    naiveMergeBookmarks(cloud, local).rows.length === 2 &&
      mergeBookmarks(cloud, local).rows.length === 1,
  )
}

console.log(`\n通过 ${pass} / 失败 ${fail}`)
if (fail) {
  console.log('\n❌ 有问题：')
  for (const f of failures) console.log(`   · ${f}`)
  process.exit(1)
}
